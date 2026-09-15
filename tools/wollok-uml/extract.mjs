/*
 * De la AST de wollok-ts a un modelo UML intermedio, independiente de PlantUML o Draw.io.
 *
 * El modelo que sale de aca es un objeto plano:
 *
 *   {
 *     entities: [{ kind, name, stereotypes, attributes, operations,
 *                  superclass, mixins, interfaces, note }],
 *     relations: [{ from, to, kind, fromMultiplicity, toMultiplicity, label }],
 *     notes:     [{ text, target, position }],
 *     warnings:  [string]
 *   }
 *
 * kind es 'class' | 'wko' | 'mixin' | 'interface'.
 */

import { annotation, arg, isHidden, unknownUmlAnnotations } from './annotations.mjs'
import { createTypeResolver, isCollectionType, elementTypeOf, withoutArticle } from './infer.mjs'
import { entityNodesOf, instantiationsOf } from './entities.mjs'
import { derivedInterfacesOf, familiesOf, wildcardsOf } from './families.mjs'

const ENTITY_KINDS = { Class: 'class', Singleton: 'wko', Mixin: 'mixin' }

export const extractModel = (environment, config = {}, options = {}) => {
	const warnings = []
	const dictionary = config.types ?? {}

	const entityNodes = entityNodesOf(environment).map(({ node }) => node).filter((node) => !isHidden(node))

	// Dos archivos pueden definir el mismo objeto (por ejemplo pepita en el item a
	// y en el item b). En un mismo diagrama eso queda como una sola caja mezclada,
	// asi que conviene generar un diagrama por archivo.
	const seenNames = new Set()
	for (const node of entityNodes) {
		if (seenNames.has(node.name)) {
			warnings.push(`${node.name}: esta definido en mas de un archivo; conviene generar un diagrama por archivo`)
		}
		seenNames.add(node.name)
	}

	// Las interfaces no existen en Wollok: se declaran con @UmlImplements y el
	// generador las materializa. Sus mensajes son la interseccion de los mensajes
	// publicos de quienes las implementan (o la lista que diga el sidecar).
	const interfaceNames = [...new Set(entityNodes.flatMap((node) =>
		arg(node, 'UmlImplements', 'interface') ? [arg(node, 'UmlImplements', 'interface')] : []
	))]
	for (const name of Object.keys(config.interfaces ?? {})) {
		if (!interfaceNames.includes(name)) interfaceNames.push(name)
	}

	// @UmlImplements puede apuntar a una clase que si existe (por ejemplo un null
	// object que reemplaza a una Persona): en ese caso no se inventa una interfaz,
	// solo se dibuja la flecha de realizacion.
	const realEntityNames = entityNodes.map((n) => n.name)
	const derivedInterfaceNames = interfaceNames.filter((name) => !realEntityNames.includes(name))
	const entityNames = [...realEntityNames, ...derivedInterfaceNames]

	// Como se tipa una referencia a un objeto well-known: por lo que implementa,
	// o por la clase de la que hereda, o por su propio nombre.
	const entityAliases = new Map(entityNodes.flatMap((node) => {
		if (node.kind !== 'Singleton') return []
		const alias = arg(node, 'UmlImplements', 'interface') ?? superclassNameOf(node)
		return alias ? [[node.name, alias]] : []
	}))

	// --- el resolvedor necesita poder preguntar que devuelve un metodo ---
	const nodesByName = new Map(entityNodes.map((node) => [node.name, node]))
	const returnTypeCache = new Map()

	/** Quienes implementan cada interfaz declarada con @UmlImplements. */
	const implementorsOf = (interfaceName) =>
		entityNodes.filter((node) => arg(node, 'UmlImplements', 'interface') === interfaceName)

	/** Quienes cumplen cada interfaz deducida; se llena al deducirlas. */
	const derivedMembers = new Map()

	const methodReturnTypeOf = (entityName, methodName, seen) => {
		const key = `${entityName}#${methodName}`
		if (returnTypeCache.has(key)) return returnTypeCache.get(key)
		// una interfaz no tiene codigo: lo que devuelve un mensaje suyo se
		// averigua en cualquiera de sus implementadores, declarados o deducidos
		const node = nodesByName.get(entityName) ?? implementorsOf(entityName)[0]
			?? nodesByName.get(derivedMembers.get(entityName)?.[0])
		if (!node) return undefined
		const method = node.methods?.find((m) => m.name === methodName)
			?? node.fields?.find((f) => f.name === methodName && f.isProperty)
		if (!method) return undefined
		const type = method.kind === 'Field'
			? typeOfField(method, node)
			: returnTypeOf(method, node, seen)
		returnTypeCache.set(key, type)
		return type
	}

	// `let`: despues de deducir interfaces se lo reemplaza por uno que tambien las
	// conoce, para tipar lo que dependia de ellas (ver la segunda pasada, abajo)
	let resolver = createTypeResolver({ entityNames, entityAliases, dictionary, methodReturnTypeOf })

	// --- tipos de campos y de metodos ---

	const scopeOf = (entityNode, extraLocals = new Map()) => {
		const localTypes = new Map(extraLocals)
		for (const field of entityNode.fields ?? []) {
			if (!localTypes.has(field.name)) localTypes.set(field.name, fieldTypeCache.get(field) ?? undefined)
		}
		return { entity: entityNode, localTypes }
	}

	const fieldTypeCache = new Map()

	const typeOfField = (field, entityNode) => {
		if (fieldTypeCache.has(field)) return fieldTypeCache.get(field)
		fieldTypeCache.set(field, undefined)   // corta ciclos

		let type = arg(field, 'UmlType', 'name')
			?? dictionary[field.name]
			?? resolver.typeOf(field.value, scopeOf(entityNode))

		// coleccion sin tipo de elemento: miramos que le agregan en los metodos
		if (isCollectionType(type) && !elementTypeOf(type)) {
			const elementType = resolver.elementTypeFromAdds(field.name, entityNode, scopeOf(entityNode))
			if (elementType) type = `${type}<${elementType}>`
		}
		if (!type) type = resolver.typeFromName(field.name)

		fieldTypeCache.set(field, type)
		return type
	}

	const returnTypeOf = (method, entityNode, seen = new Set()) => {
		const declared = arg(method, 'UmlReturns', 'type')
		if (declared) return declared
		if (method.body === 'native' || !method.body) return undefined

		const localTypes = new Map()
		for (const parameter of method.parameters ?? []) {
			localTypes.set(parameter.name, typeOfParameter(parameter))
		}
		const scope = scopeOf(entityNode, localTypes)

		const sentences = method.body.sentences ?? []
		const returned = sentences.find((s) => s.kind === 'Return')
		// un metodo sin return es un comando: no lleva tipo de retorno
		if (!returned) return undefined
		return resolver.typeOf(returned.value, scope, seen)
	}

	const typeOfParameter = (parameter) =>
		arg(parameter, 'UmlType', 'name')
			?? dictionary[parameter.name]
			?? resolver.typeFromName(parameter.name)

	const typeOfInheritedField = (parentName, fieldName) => {
		const parent = nodesByName.get(parentName)
		const field = parent?.fields?.find((f) => f.name === fieldName)
		return field ? typeOfField(field, parent) : undefined
	}

	// Va DESPUES de definir el tipado de campos y metodos, no antes: el valor de un
	// `new` puede ser un envio de mensaje (`empresa = fabrica.laEmpresa()`), y para
	// tiparlo el resolvedor llama a returnTypeOf y typeOfField. Declaradas con
	// `const` mas abajo, usarlas antes de su declaracion revienta.
	/*
	 * --- lo que dice el codigo de un atributo por COMO SE LO INICIALIZA ---
	 *
	 * Un atributo sin valor inicial (`const empresa`) no dice de que tipo es. Pero
	 * el codigo si lo dice en otro lado: `new Persona(empresa = personal)` y
	 * `new Persona(empresa = movistar)`. Eso es exactamente "ocupar el mismo
	 * lugar", el criterio 3 de las familias, solo que antes solo se miraba el valor
	 * inicial de cada atributo y este caso quedaba afuera.
	 *
	 * Se guarda lo que recibe cada atributo, sin repetir y en el orden del codigo.
	 * Una referencia a un objeto se guarda con SU nombre, no con lo que implementa:
	 * para saber quien comparte un lugar hacen falta los objetos concretos.
	 *
	 * @returns Map(clase -> Map(atributo -> [tipos]))
	 */
	const instantiatedValues = new Map()
	const lastSegment = (name) => name?.split('.').pop()
	for (const { node, owner } of instantiationsOf(environment)) {
		const className = lastSegment(node.instantiated?.name)
		if (!nodesByName.has(className)) continue
		for (const namedArgument of node.args ?? []) {
			const value = namedArgument.value
			const referenced = value?.kind === 'Reference' ? lastSegment(value.name)
				: value?.kind === 'New' ? lastSegment(value.instantiated?.name)
					: undefined
			const type = nodesByName.has(referenced)
				? referenced
				: resolver.typeOf(value, owner ? { entity: owner, localTypes: new Map() } : { localTypes: new Map() })
			if (!type) continue
			const byAttribute = instantiatedValues.get(className) ?? new Map()
			const types = byAttribute.get(namedArgument.name) ?? []
			if (!types.includes(type)) types.push(type)
			byAttribute.set(namedArgument.name, types)
			instantiatedValues.set(className, byAttribute)
		}
	}

	/** Lo que recibe un atributo, contando lo que reciben las subclases. */
	const superclassByName = new Map(entityNodes.map((entityNode) => [entityNode.name, superclassNameOf(entityNode)]))
	const inheritsFrom = (name, ancestor) => {
		for (let current = name; current; current = superclassByName.get(current)) {
			if (current === ancestor) return true
		}
		return false
	}
	const slotTypesOf = (ownerName, fieldName) => {
		const types = []
		for (const [className, byAttribute] of instantiatedValues) {
			if (!inheritsFrom(className, ownerName)) continue
			for (const type of byAttribute.get(fieldName) ?? []) {
				if (!types.includes(type)) types.push(type)
			}
		}
		return types
	}

	// --- armado de las entidades ---

	const relations = []
	const notes = []

	const entities = entityNodes.map((node) => {
		for (const unknown of unknownUmlAnnotations(node)) {
			warnings.push(`${node.name}: anotacion desconocida @${unknown}`)
		}

		const attributes = (node.fields ?? [])
			.filter((field) => !isHidden(field))
			.map((field) => {
				const declared = typeOfField(field, node)
				const slotTypes = slotTypesOf(node.name, field.name)
				// Si el codigo no dice el tipo, lo dice lo que el atributo recibe. Una
				// sola cosa es el tipo, como en una referencia (un WKO vale por lo que
				// implementa). Varias son CANDIDATAS: se usa la primera para poder armar
				// la relacion, y mas abajo, con las familias ya calculadas, se reemplaza
				// por la abstraccion que las une, o se descarta si no hay ninguna.
				const fromSlots = !declared && slotTypes.length > 0
				const type = declared
					?? (slotTypes.length === 1 ? entityAliases.get(slotTypes[0]) ?? slotTypes[0] : slotTypes[0])
				if (!type) warnings.push(`${node.name}.${field.name}: no pude inferir el tipo (usa @UmlType o el diccionario "types")`)
				return {
					name: field.name,
					type,
					...(slotTypes.length ? { slotTypes } : {}),
					...(fromSlots && slotTypes.length > 1 ? { typeFromCandidates: true } : {}),
					// una property genera accesores publicos; el resto es privado
					visibility: field.isProperty ? '+' : '-',
					mutability: field.isConstant ? 'const' : 'var',
					defaultValue: literalTextOf(field.value),
					relation: annotation(field, 'UmlRelation')?.args,
				}
			})

		// object x inherits Clase(campo = valor): esos valores describen al WKO
		const inheritedArguments = (node.supertypes ?? []).flatMap((supertype) =>
			(supertype.args ?? []).map((namedArgument) => ({
				name: namedArgument.name,
				type: typeOfInheritedField(supertype.reference?.name, namedArgument.name),
				visibility: '-',
				mutability: 'const',
				defaultValue: literalTextOf(namedArgument.value),
				relation: undefined,
				inherited: true,
			}))
		)

		const operations = (node.methods ?? [])
			// los accesores de una property los sintetiza Wollok: no estan en el
			// codigo (no tienen sourceMap) y no van al diagrama
			.filter((method) => method.sourceMap && !isHidden(method))
			.map((method) => ({
				name: method.name,
				parameters: (method.parameters ?? []).map((parameter) => ({
					name: parameter.name,
					type: typeOfParameter(parameter),
				})),
				returns: returnTypeOf(method, node),
			}))

		const noteText = arg(node, 'UmlNote', 'text')
		if (noteText) {
			notes.push({ text: noteText, target: node.name, position: arg(node, 'UmlNote', 'position') ?? 'right' })
		}

		const stereotypes = []
		const extraStereotype = arg(node, 'UmlStereotype', 'name')
		if (extraStereotype) stereotypes.push(extraStereotype)

		// Los accesores de una property no se dibujan en la caja (ya se ve el
		// atributo con visibilidad +), pero SI son parte de los mensajes que el
		// objeto entiende, y por lo tanto cuentan para derivar una interfaz.
		const propertyMessages = attributes
			.filter((attribute) => attribute.visibility === '+' && !attribute.inherited)
			.map((attribute) => ({ name: attribute.name, parameters: [], returns: attribute.type }))

		return {
			kind: ENTITY_KINDS[node.kind],
			name: node.name,
			stereotypes,
			// En Wollok no hay palabra `abstract`: una clase es abstracta cuando le
			// queda algun metodo sin cuerpo, propio o heredado sin redefinir. Eso ya
			// lo resuelve wollok-ts, y distingue bien el caso de la subclase que si
			// lo implementa.
			isAbstract: node.isAbstract === true,
			attributes: [...inheritedArguments, ...attributes],
			operations,
			messages: [...operations, ...propertyMessages],
			superclass: superclassNameOf(node),
			mixins: mixinNamesOf(node),
			interfaces: arg(node, 'UmlImplements', 'interface') ? [arg(node, 'UmlImplements', 'interface')] : [],
		}
	})

	// --- interfaces derivadas ---

	const interfaces = derivedInterfaceNames.map((name) => {
		const declared = config.interfaces?.[name] ?? {}
		const implementors = entities.filter((entity) => entity.interfaces.includes(name))
		if (declared.note) notes.push({ text: declared.note, target: name, position: declared.position ?? 'top' })
		return {
			kind: 'interface',
			name,
			stereotypes: [],
			attributes: [],
			// la interfaz es lo que TODOS sus implementadores entienden
			operations: declared.methods
				? declared.methods.map(parseSignature)
				: commonMessages(implementors),
			messages: [],
			superclass: null,
			mixins: [],
			interfaces: [],
		}
	})

	// --- relaciones ---

	const known = new Set([...entities.map((e) => e.name), ...interfaces.map((i) => i.name)])

	for (const entity of entities) {
		if (entity.superclass && known.has(entity.superclass)) {
			relations.push({ kind: 'inheritance', from: entity.superclass, to: entity.name })
		}
		for (const mixin of entity.mixins) {
			if (known.has(mixin)) relations.push({ kind: 'mixin', from: mixin, to: entity.name })
		}
		for (const iface of entity.interfaces) {
			relations.push({ kind: 'realization', from: iface, to: entity.name })
		}
		for (const attribute of entity.attributes) {
			if (attribute.inherited) continue
			// solo es una relacion si el tipo es otra entidad del diagrama;
			// si no, es un atributo comun y queda dentro de la caja
			const target = elementTypeOf(attribute.type) ?? attribute.type
			if (!target || !known.has(target)) continue
			const isCollection = isCollectionType(attribute.type)
			// queda marcado para poder esconderlo de la caja si se pide
			// --associations=arrow (si no, se ve el atributo Y la flecha)
			attribute.isRelation = true
			relations.push({
				kind: attribute.relation?.kind ?? (isCollection ? 'aggregation' : 'association'),
				from: entity.name,
				to: target,
				// De que atributo salio: lo necesita el diagrama de clases en draw.io
				// para que la flecha arranque a la altura de la fila donde esta
				// declarado. No alcanza con `label`, que el sidecar puede pisar, ni
				// con el par (from, to): dos atributos distintos pueden apuntar a la
				// misma entidad (Persona.duenio y Persona.victimas, por ejemplo).
				fromAttribute: attribute.name,
				fromMultiplicity: attribute.relation?.from ?? '1',
				toMultiplicity: attribute.relation?.multiplicity ?? (isCollection ? '*' : '1'),
				label: attribute.relation?.label ?? attribute.name,
			})
		}
	}

	for (const extra of config.relations ?? []) relations.push({ kind: 'association', ...extra })
	for (const note of config.notes ?? []) notes.push({ position: 'right', ...note })

	/*
	 * --- los roles de los parametros ---
	 *
	 * Lo que se le manda a un parametro dice que rol cumple lo que llega ahi:
	 * `unMensajero.peso()` pide un Mensajero que sepa peso(). Se juntan todos los
	 * parametros con el mismo nombre de rol, en cualquier metodo, porque es el
	 * mismo concepto usado en distintos lugares. De aca sale el nombre de las
	 * familias que nadie guarda en un atributo (ver derivedInterfacesOf).
	 *
	 * Los mensajes que entiende CUALQUIER objeto no cuentan: comparar
	 * `unMensajero == otro` no dice nada de que clase de cosa es.
	 */
	const EVERY_OBJECT_UNDERSTANDS = new Set(['==', '!=', '===', '!==', 'equals', 'toString', 'printString', 'identity', 'className', 'kindName'])
	const parameterRoles = new Map()
	for (const node of entityNodes) {
		for (const method of node.methods ?? []) {
			if (!method.sourceMap) continue
			for (const parameter of method.parameters ?? []) {
				const sent = new Set()
				for (const send of method.descendants ?? []) {
					if (send.kind !== 'Send' || EVERY_OBJECT_UNDERSTANDS.has(send.message)) continue
					if (send.receiver?.kind !== 'Reference' || send.receiver.name !== parameter.name) continue
					sent.add(`${send.message}/${(send.args ?? []).length}`)
				}
				if (!sent.size) continue
				const bare = withoutArticle(parameter.name)
				const roleName = bare.charAt(0).toUpperCase() + bare.slice(1)
				const role = parameterRoles.get(roleName) ?? { messages: new Set(), sites: 0 }
				for (const selector of sent) role.messages.add(selector)
				role.sites += 1
				parameterRoles.set(roleName, role)
			}
		}
	}

	const model = { entities, interfaces, relations, notes, warnings }

	// Las familias se calculan ACA, sobre el modelo todavia sin tocar, y quedan
	// cacheadas contra este objeto (ver families.mjs). Mas abajo el retargeteo
	// reescribe el tipo de los atributos, y el criterio 3 —que mira justamente
	// esos tipos— dejaria de ver lo que vio. Congelarlas antes garantiza que el
	// color y las interfaces deducidas hablen de las MISMAS familias.
	familiesOf(model)

	// El que ocupa dos lugares distintos queda afuera de las familias por lugar:
	// no se puede elegir cual de los dos roles es "el" rol. Conviene decirlo, con
	// la salida a mano incluida.
	for (const [name, slots] of wildcardsOf(model)) {
		warnings.push(`${name}: ocupa dos lugares distintos (${slots.join(', ')}), asi que queda fuera de las familias por lugar. Si cumple los dos roles, declaralos con @UmlImplements`)
	}

	// --- las interfaces que el codigo no declara ---
	// Van al final, cuando ya estan las entidades y las relaciones: se deducen de
	// las familias polimorficas (ver families.mjs) y se agregan como una interfaz
	// mas, con sus realizaciones. De ahi en adelante el resto del pipeline no
	// distingue si la escribiste vos o la dedujo la herramienta.
	if (options.deriveInterfaces !== false) {
		for (const derived of derivedInterfacesOf(model, { parameterRoles })) {
			interfaces.push({
				kind: 'interface',
				name: derived.name,
				stereotypes: [],
				attributes: [],
				operations: derived.operations,
				messages: [],
				superclass: null,
				mixins: [],
				interfaces: [],
				derived: true,
			})
			for (const member of derived.members) {
				entities.find((entity) => entity.name === member).interfaces.push(derived.name)
				relations.push({ kind: 'realization', from: derived.name, to: member })
			}
			derivedMembers.set(derived.name, derived.members)
		}
	}

	/*
	 * --- segunda pasada: los tipos que dependian de una interfaz deducida ---
	 *
	 * Los parametros se tiparon ANTES de que existieran las interfaces deducidas,
	 * asi que `unMensajero` quedo sin tipo. Ahora que Mensajero existe se vuelve a
	 * mirar cada parametro que quedo sin tipo, y cada retorno que quedo sin tipo:
	 * `matrix.dejasPasarA(unMensajero)` devuelve `unMensajero.podesLlamar()`, que
	 * recien ahora se sabe que es Boolean.
	 *
	 * Solo se completa lo que falta: lo que ya tenia tipo no se toca.
	 */
	if (derivedMembers.size) {
		resolver = createTypeResolver({
			entityNames: [...entityNames, ...derivedMembers.keys()],
			entityAliases,
			dictionary,
			methodReturnTypeOf,
		})
		// lo que se calculo sin conocer las interfaces puede haber quedado en undefined
		returnTypeCache.clear()
		const entitiesByNodeName = new Map(entities.map((entity) => [entity.name, entity]))
		for (const node of entityNodes) {
			const entity = entitiesByNodeName.get(node.name)
			for (const method of node.methods ?? []) {
				const arity = (method.parameters ?? []).length
				const operation = entity?.operations.find((candidate) =>
					candidate.name === method.name && candidate.parameters.length === arity)
				if (!operation) continue
				operation.parameters.forEach((parameter, index) => {
					if (!parameter.type) parameter.type = typeOfParameter(method.parameters[index])
				})
				if (!operation.returns) operation.returns = returnTypeOf(method, node)
			}
		}
	}

	// --- las referencias apuntan a la abstraccion ---
	// `var celular = samsung` se infiere de tipo `samsung`, que es el objeto
	// concreto con el que arranca. Pero si samsung cumple una interfaz —declarada
	// o deducida— o hereda de una clase abstracta, el TIPO de la referencia es esa
	// abstraccion: eso es lo que dice el diagrama de clases. Asi que la flecha
	// apunta ahi, y la fila de la caja muestra `celular : Celular = samsung`.
	//
	// Va al final, cuando ya existen todas las interfaces (incluidas las
	// deducidas) y ya se calcularon las familias, que se apoyan en el tipo
	// concreto para saber quien ocupa el mismo lugar.
	const abstractionOf = abstractionResolver(entities)
	for (const relation of relations) {
		// solo las que salen de un atributo: una relacion escrita a mano en el
		// sidecar dice lo que el autor quiso decir y no se toca
		if (STRUCTURAL_KINDS.includes(relation.kind) || !relation.fromAttribute) continue
		const abstraction = abstractionOf(relation.to)
		// una referencia que ya apuntaba a la abstraccion, o que pasaria a apuntarse
		// a si misma, se deja como esta
		if (!abstraction || abstraction === relation.from) continue

		relation.to = abstraction
		const owner = entities.find((entity) => entity.name === relation.from)
		const attribute = owner?.attributes.find((candidate) => candidate.name === relation.fromAttribute)
		if (attribute?.type) {
			// en una coleccion lo que cambia es el tipo de elemento:
			// List<Pertenencia> -> List<MedidaDeSeguridad>
			const element = elementTypeOf(attribute.type)
			attribute.type = element
				? attribute.type.replace(`<${element}>`, `<${abstraction}>`)
				: abstraction
		}
	}

	/*
	 * --- un atributo que recibe cosas distintas ---
	 *
	 * Si recibio varias candidatas, su tipo provisorio es la primera. Eso no puede
	 * quedar asi: `empresa : personal` diria que la empresa es siempre personal,
	 * cuando tambien puede ser movistar. Tres salidas, de mejor a peor:
	 *
	 *   - el retargeteo ya lo llevo a una abstraccion (la interfaz deducida de la
	 *     familia, o una clase abstracta): ese es el tipo, y no hay nada que hacer;
	 *   - las candidatas heredan de una misma clase: el tipo es esa clase;
	 *   - no tienen nada en comun: el atributo queda SIN tipo y se avisa por que.
	 *     Es menos de lo que se quisiera, pero no es mentira.
	 */
	const entitiesByName = new Map(entities.map((entity) => [entity.name, entity]))
	for (const entity of entities) {
		for (const attribute of entity.attributes) {
			if (!attribute.typeFromCandidates) continue
			if (!attribute.slotTypes.includes(attribute.type)) continue
			const relation = relations.find((candidate) =>
				candidate.from === entity.name && candidate.fromAttribute === attribute.name)
			const common = commonSuperclassOf(attribute.slotTypes, entitiesByName)
			if (common) {
				attribute.type = common
				if (relation) relation.to = common
				continue
			}
			attribute.type = undefined
			attribute.isRelation = false
			if (relation) relations.splice(relations.indexOf(relation), 1)
			// El aviso tiene que decir el motivo verdadero. Que no haya abstraccion no
			// quiere decir que no se parezcan: pueden ser de la misma familia y no tener
			// interfaz (con --without-inference, o si uno ya hereda de una clase
			// concreta). En ese caso lo util es decir como declararla.
			const family = familiesOf(model)
			const together = new Set(attribute.slotTypes.map((type) => family.get(type))).size === 1
				&& attribute.slotTypes.every((type) => family.has(type))
			warnings.push(together
				? `${entity.name}.${attribute.name}: recibe ${attribute.slotTypes.join(', ')}, que son polimorficos entre si pero no tienen una interfaz ni una superclase que los una, asi que no pude inferir el tipo (declara la interfaz con @UmlImplements, o usa @UmlType)`
				: `${entity.name}.${attribute.name}: recibe ${attribute.slotTypes.join(', ')}, que no son polimorficos entre si, asi que no pude inferir el tipo (usa @UmlType o el diccionario "types")`)
		}
	}

	/*
	 * --- dependencias hacia una interfaz ---
	 *
	 * `paquete.podesSerEntregadoPor(unMensajero : Mensajero, unaUbicacion :
	 * Ubicacion)` usa un Mensajero y una Ubicacion sin guardarlos: eso es una
	 * dependencia, la flecha punteada `paquete ..> Mensajero`.
	 *
	 * Pero NO se dibuja desde un metodo que es parte del protocolo de una interfaz
	 * que la entidad cumple. `brooklyn.dejasPasarA(unMensajero : Mensajero)` es el
	 * mensaje de Ubicacion: el tipo Mensajero ya se lee en la firma, y repetir una
	 * flecha por cada implementador solo llenaria el dibujo con lo mismo dicho tres
	 * veces.
	 *
	 * Tampoco se dibuja si esas dos cajas ya estan unidas por otra relacion: una
	 * asociacion o una realizacion ya dicen mas que una dependencia.
	 */
	const interfacesByName = new Map(interfaces.map((entity) => [entity.name, entity]))
	for (const entity of entities) {
		const protocol = new Set(entity.interfaces.flatMap((name) =>
			(interfacesByName.get(name)?.operations ?? []).map((operation) => `${operation.name}/${operation.parameters.length}`)))
		const targets = []
		for (const operation of entity.operations) {
			if (protocol.has(`${operation.name}/${operation.parameters.length}`)) continue
			for (const parameter of operation.parameters) {
				const target = parameter.type
				if (!interfacesByName.has(target) || target === entity.name || targets.includes(target)) continue
				targets.push(target)
			}
		}
		for (const target of targets) {
			const linked = relations.some((relation) =>
				(relation.from === entity.name && relation.to === target) || (relation.from === target && relation.to === entity.name))
			if (!linked) relations.push({ kind: 'dependency', from: entity.name, to: target })
		}
	}

	return model
}

/**
 * La clase mas cercana de la que heredan todas, o undefined. Una entidad cuenta
 * como su propia ancestro: [Celular, samsung] tienen en comun a Celular.
 */
const commonSuperclassOf = (names, entitiesByName) => {
	const lineageOf = (name) => {
		const lineage = []
		for (let current = name; entitiesByName.has(current); current = entitiesByName.get(current).superclass) {
			lineage.push(current)
		}
		return lineage
	}
	const [first, ...rest] = names.map(lineageOf)
	return first?.find((ancestor) => rest.every((lineage) => lineage.includes(ancestor)))
}

const STRUCTURAL_KINDS = ['inheritance', 'realization', 'mixin']

/**
 * La abstraccion que le corresponde a una entidad: la interfaz que cumple, o la
 * clase abstracta de la que hereda. Gana la interfaz, que es el rol mas
 * especifico; una superclase CONCRETA no cuenta, porque no es una abstraccion.
 */
const abstractionResolver = (entities) => {
	const byName = new Map(entities.map((entity) => [entity.name, entity]))
	return (name) => {
		const entity = byName.get(name)
		if (!entity) return undefined
		if (entity.interfaces.length) return entity.interfaces[0]
		const superclass = entity.superclass && byName.get(entity.superclass)
		return superclass?.isAbstract ? entity.superclass : undefined
	}
}

// ---------- auxiliares ----------

const superclassNameOf = (node) => {
	const name = node.superclass?.name
	return name && name !== 'Object' ? name : null
}

const mixinNamesOf = (node) =>
	(node.supertypes ?? [])
		.filter((supertype) => supertype.reference?.target?.kind === 'Mixin')
		.map((supertype) => supertype.reference.name)

/** Texto del valor inicial, solo cuando es un literal o una referencia simple. */
const literalTextOf = (value) => {
	if (!value) return undefined
	// sin sourceMap = no lo escribio nadie, lo puso el parser (const sin valor)
	if (!value.sourceMap) return undefined
	if (value.kind === 'Literal') {
		// las colecciones vacias no aportan nada: ya lo dice el tipo
		if (Array.isArray(value.value)) return undefined
		if (value.value === null) return undefined
		return typeof value.value === 'string' ? `"${value.value}"` : String(value.value)
	}
	if (value.kind === 'Reference') return value.name
	return undefined
}

/** Los mensajes que entienden TODOS los implementadores de una interfaz. */
const commonMessages = (implementors) => {
	if (!implementors.length) return []
	const [first, ...rest] = implementors
	const understands = (entity, message) =>
		entity.messages.some((m) => m.name === message.name && m.parameters.length === message.parameters.length)
	return first.messages.filter((message) => rest.every((other) => understands(other, message)))
}

/** "dificultadPara(pertenencia : Pertenencia) : Number" -> objeto operacion */
const parseSignature = (signature) => {
	const match = signature.match(/^\s*([^(]+)\(([^)]*)\)\s*(?::\s*(.+))?$/)
	if (!match) return { name: signature.trim(), parameters: [], returns: undefined }
	const [, name, params, returns] = match
	return {
		name: name.trim(),
		parameters: params.trim() ? params.split(',').map((p) => {
			const [pName, pType] = p.split(':').map((s) => s.trim())
			return { name: pName, type: pType }
		}) : [],
		returns: returns?.trim(),
	}
}
