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
import { createTypeResolver, isCollectionType, elementTypeOf } from './infer.mjs'
import { entityNodesOf } from './entities.mjs'
import { derivedInterfacesOf } from './families.mjs'

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

	const methodReturnTypeOf = (entityName, methodName, seen) => {
		const key = `${entityName}#${methodName}`
		if (returnTypeCache.has(key)) return returnTypeCache.get(key)
		// una interfaz no tiene codigo: lo que devuelve un mensaje suyo se
		// averigua en cualquiera de sus implementadores
		const node = nodesByName.get(entityName) ?? implementorsOf(entityName)[0]
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

	const resolver = createTypeResolver({ entityNames, entityAliases, dictionary, methodReturnTypeOf })

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
				const type = typeOfField(field, node)
				if (!type) warnings.push(`${node.name}.${field.name}: no pude inferir el tipo (usa @UmlType o el diccionario "types")`)
				return {
					name: field.name,
					type,
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

	// --- las interfaces que el codigo no declara ---
	// Van al final, cuando ya estan las entidades y las relaciones: se deducen de
	// las familias polimorficas (ver families.mjs) y se agregan como una interfaz
	// mas, con sus realizaciones. De ahi en adelante el resto del pipeline no
	// distingue si la escribiste vos o la dedujo la herramienta.
	if (options.deriveInterfaces !== false) {
		for (const derived of derivedInterfacesOf({ entities, interfaces, relations })) {
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

	return { entities, interfaces, relations, notes, warnings }
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
