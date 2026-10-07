/*
 * Familias polimorficas del modelo de CLASES.
 *
 * El diagrama de objetos ya las detectaba: al ejecutar el ejemplo se ve que dos
 * objetos ocupan el mismo lugar o entienden los mismos mensajes, y se los pinta
 * del mismo color. El diagrama de clases, en cambio, no infería nada: solo
 * dibujaba una interfaz si vos la declarabas con @UmlImplements o en el sidecar.
 *
 * Aca se portan los mismos tres criterios, pero leyendo el codigo en vez de
 * ejecutarlo, y se agrega un cuarto. Dos entidades son de la misma familia si:
 *
 *   1. hay herencia, mixin, o las dos declaran la misma interfaz;
 *   2. entienden EXACTAMENTE el mismo conjunto de mensajes;
 *   3. ocupan el mismo lugar — y ademas comparten al menos un mensaje. Un lugar
 *      es un atributo:
 *        - un atributo con el mismo nombre (`celular` en juliana y en catalina)
 *          que en un caso es una y en otro es la otra. Se ve en el valor inicial
 *          y en los `new`: `new Persona(empresa = personal)` y `new
 *          Persona(empresa = movistar)` ponen a personal y a movistar ahi;
 *        - los elementos de una misma coleccion: `#{ springfield, albuquerque }`
 *          (ver `elements` en extract.mjs). Su lugar es el del singular: los
 *          elementos de `centrales` estan en el mismo lugar que una `central`;
 *   4. una entidad, o una familia entera, entiende TODO lo que entiende otra
 *      familia (y quizas mas): centralEolica entiende produccionEnergeticaEn y
 *      contamina, como las otras centrales, y ademas sabe agregar turbinas. Se la
 *      puede usar donde se usa cualquiera de ellas, asi que es de la familia.
 *
 * El criterio 3 es mas flojo que el del diagrama de objetos, que puede mirar que
 * paso de verdad en tiempo de ejecucion. Aca solo se ve lo que dice el codigo,
 * asi que se compara por NOMBRE de atributo entre owners distintos.
 * De ahi el resguardo de exigir un mensaje en comun: sin el, dos entidades que
 * casualmente tienen un atributo `nombre` quedarian emparentadas.
 *
 * Con las familias en la mano se hacen dos cosas: pintarlas del mismo color, y
 * agregar la caja de interfaz que falta (ver derivedInterfacesOf).
 */

import { singularRoleOf } from './infer.mjs'

/**
 * Los mensajes que entiende una entidad, como `nombre/aridad`. Sin los @UmlPrivate:
 * que dos objetos tengan un metodo interno con el mismo nombre no dice que se
 * puedan usar uno en lugar del otro.
 */
const selectorsOf = (entity) =>
	new Set(entity.operations
		.filter((operation) => operation.visibility !== '-')
		.map((operation) => `${operation.name}/${operation.parameters.length}`))

/** Ya cuelga de una abstraccion dibujada: superclase, mixin o interfaz declarada. */
const hasAbstraction = (entity) =>
	Boolean(entity.superclass) || entity.mixins.length > 0 || entity.interfaces.length > 0

/** Lo que entienden todas: la interseccion de sus mensajes. */
const commonProtocolOf = (entities) => entities.map(selectorsOf)
	.reduce((common, selectors) => new Set([...common].filter((selector) => selectors.has(selector))))

const shareSomeMessage = (a, b) => {
	const messages = selectorsOf(b)
	return [...selectorsOf(a)].some((selector) => messages.has(selector))
}

/*
 * Las familias de un modelo se calculan UNA sola vez y quedan cacheadas contra
 * el objeto del modelo.
 *
 * No es una optimizacion, es una cuestion de correccion. extract.mjs muta el
 * modelo despues de armarlo: retargetea las referencias hacia la abstraccion y
 * con eso reescribe el tipo de los atributos (`celular : samsung` pasa a
 * `celular : Celular`). Si las familias se recalcularan sobre el modelo ya
 * mutado, el criterio 3 —que mira justamente esos tipos— dejaria de ver lo que
 * vio, y quien pregunta despues (el color) obtendria una respuesta distinta de
 * la que se uso para deducir las interfaces.
 *
 * Es un WeakMap para no ensuciar el modelo con un campo que despues habria que
 * ignorar al serializar.
 */
const CACHE = new WeakMap()

/** Los comodines que se saltearon, para poder avisar. Ver el criterio 3. */
const WILDCARDS = new WeakMap()

/** Los que se sumaron a una familia por el criterio 4: no le ponen el nombre. */
const JOINERS = new WeakMap()

/**
 * Los que entraron a su familia por el criterio 4. Una referencia que solo guarda
 * a alguno de ellos sigue con su tipo concreto: `central = centralEolica` le
 * puede pedir agregarTurbina(), que la interfaz de las centrales no tiene.
 */
export const joinersOf = (model) => {
	familiesOf(model)
	return JOINERS.get(model) ?? new Set()
}

/*
 * Mensajes que no dicen nada del rol: los entiende cualquier objeto, o cualquier
 * visual de Wollok Game. No alcanzan para que el criterio 4 sume a alguien.
 */
const GENERIC_MESSAGES = new Set([
	'==/1', '!=/1', '===/1', '!==/1', 'equals/1', 'toString/0', 'printString/0', 'identity/0',
	'className/0', 'kindName/0', 'initialize/0',
	'position/0', 'image/0', 'text/0', 'textColor/0',
])

/**
 * Las entidades que ocupan mas de un lugar distinto, con los nombres de esos
 * lugares. Quedan afuera de las familias por lugar (ver el criterio 3), asi que
 * conviene avisarlo: es un caso que la herramienta no puede resolver sola pero
 * vos si, declarando los roles con @UmlImplements.
 *
 * @returns Map(nombre de entidad -> [nombres de atributo])
 */
export const wildcardsOf = (model) => {
	familiesOf(model)
	return WILDCARDS.get(model) ?? new Map()
}

/**
 * @param model  el que devuelve extractModel
 * @returns Map(nombre de entidad -> nombre del representante de su familia)
 *          El representante es el miembro que aparece primero en el codigo, asi
 *          el resultado no depende del orden en que se recorran las relaciones.
 */
export const familiesOf = (model) => {
	const cached = CACHE.get(model)
	if (cached) return cached
	const computed = computeFamilies(model)
	CACHE.set(model, computed)
	return computed
}

const computeFamilies = (model) => {
	const entities = model.entities
	const index = new Map(entities.map((entity, i) => [entity.name, i]))
	const byName = new Map(entities.map((entity) => [entity.name, entity]))

	const parent = new Map(entities.map((entity) => [entity.name, entity.name]))
	const find = (name) => {
		while (parent.get(name) !== name) {
			parent.set(name, parent.get(parent.get(name)))
			name = parent.get(name)
		}
		return name
	}
	const union = (a, b) => {
		if (!parent.has(a) || !parent.has(b)) return
		const [ra, rb] = [find(a), find(b)]
		if (ra === rb) return
		if (index.get(ra) <= index.get(rb)) parent.set(rb, ra)
		else parent.set(ra, rb)
	}

	// 1. herencia, mixins e interfaz declarada
	const byInterface = new Map()
	for (const entity of entities) {
		if (entity.superclass) union(entity.superclass, entity.name)
		for (const mixin of entity.mixins) union(mixin, entity.name)
		for (const name of entity.interfaces) {
			if (byInterface.has(name)) union(byInterface.get(name), entity.name)
			else byInterface.set(name, entity.name)
		}
	}

	// 2. mismo conjunto de mensajes
	const bySelectors = new Map()
	for (const entity of entities) {
		const key = [...selectorsOf(entity)].sort().join(',')
		if (!key) continue                    // sin metodos propios no distingue a nadie
		if (bySelectors.has(key)) union(bySelectors.get(key), entity.name)
		else bySelectors.set(key, entity.name)
	}

	// 3. ocupan el mismo lugar
	const bySlot = new Map()
	const place = (slot, name) => {
		if (!byName.has(name)) return
		if (!bySlot.has(slot)) bySlot.set(slot, [])
		bySlot.get(slot).push(name)
	}
	for (const entity of entities) {
		for (const attribute of entity.attributes) {
			if (attribute.inherited) continue
			// su tipo, y todo lo que recibe al crear el objeto (ver slotTypes en extract.mjs)
			for (const type of new Set([attribute.type, ...(attribute.slotTypes ?? [])])) {
				if (!type || !byName.has(type)) continue
				place(attribute.name, type)
			}
		}
		// los elementos de una coleccion estan en el lugar de su singular: `centrales`
		// y `central` son el mismo rol (ver elements en extract.mjs)
		for (const attribute of entity.attributes) {
			if (attribute.inherited) continue
			for (const element of attribute.elements ?? []) place(singularRoleOf(attribute.name) ?? attribute.name, element)
		}
	}
	/*
	 * Un COMODIN ocupa dos lugares distintos a la vez: `satelital` es el `celular`
	 * de juliana y tambien su `empresa`. Si se lo une por los dos lados hace de
	 * PUENTE y los dos roles colapsan en una familia sola que no comparte ningun
	 * mensaje, o sea que el color pasa a decir que un celular y una empresa son
	 * intercambiables — justo lo contrario de lo que paso.
	 *
	 * La causa de fondo es que "ocupar el mismo lugar" NO es transitivo, y
	 * union-find fuerza la transitividad: samsung ~ satelital por `celular` y
	 * satelital ~ movistar por `empresa`, pero samsung y movistar no tienen nada
	 * que ver.
	 *
	 * Como el criterio no puede elegir cual de los dos roles es "el" rol —los dos
	 * son ciertos— no elige ninguno: se saltea al comodin. Queda con su propio
	 * color y sin interfaz deducida. Es MENOS de lo que se sabe, pero no es
	 * mentira; y el aviso que sale por consola dice como declararlo a mano.
	 *
	 * Propiedad que lo hace barato de aceptar: esto solo puede QUITAR uniones,
	 * nunca agregar una. Un falso positivo cuesta un color de mas, jamas un color
	 * que miente.
	 */
	/*
	 * Pero dos lugares no siempre son dos roles. samsung puede ser el `celular` de
	 * juliana y estar tambien en el `stock` de un negocio, con nokia: son dos
	 * lugares y un solo rol, celular. Lo que distingue a satelital es que sus dos
	 * lugares piden cosas distintas: llamar y bateria en uno, cobrar en el otro.
	 *
	 * Asi que un comodin es el que esta en dos lugares cuyos OTROS inquilinos cumplen
	 * roles distintos. Que sea el mismo rol se mide por protocolo: lo que entienden
	 * todos los de un lado lo entienden tambien todos los del otro. No alcanza con
	 * que compartan UN mensaje: un celular y una empresa pueden tener los dos un
	 * nombre(), y un prepago que tambien cobra no convierte a movistar en celular.
	 * Los mensajes que entiende cualquier objeto o cualquier visual no cuentan.
	 *
	 * Se comparan solo los que estan en uno de los dos lugares y no en el otro: si
	 * dos objetos hibridos estan los dos en los dos lugares, cada uno no puede hacer
	 * de prueba de que el otro no es comodin.
	 */
	const slotsOf = new Map()
	for (const [slot, types] of bySlot) {
		// un lugar con un solo inquilino no habla de roles
		const tenants = new Set(types)
		if (tenants.size < 2) continue
		for (const type of tenants) slotsOf.set(type, [...(slotsOf.get(type) ?? []), { slot, tenants }])
	}
	const roleProtocolOf = (names) =>
		[...commonProtocolOf(names.map((name) => byName.get(name)))].filter((selector) => !GENERIC_MESSAGES.has(selector))
	const playsRole = (names, protocol) => protocol.length > 0
		&& names.every((name) => protocol.every((selector) => selectorsOf(byName.get(name)).has(selector)))
	const differentRoles = (name, a, b) => {
		const onlyA = [...a.tenants].filter((tenant) => tenant !== name && !b.tenants.has(tenant))
		const onlyB = [...b.tenants].filter((tenant) => tenant !== name && !a.tenants.has(tenant))
		if (!onlyA.length || !onlyB.length) return false
		// el rol de cada lugar es lo que comparten sus inquilinos, contando al que esta
		// en los dos: lo que solo sabe hacer iphone (tieneFaceId) no es del rol celular
		return !playsRole(onlyB, roleProtocolOf([...onlyA, name])) && !playsRole(onlyA, roleProtocolOf([...onlyB, name]))
	}
	const wildcards = new Map([...slotsOf]
		.filter(([name, slots]) => slots.some((a, i) => slots.slice(i + 1).some((b) => differentRoles(name, a, b))))
		.map(([name, slots]) => [name, slots.map(({ slot }) => slot)]))
	WILDCARDS.set(model, wildcards)

	for (const types of bySlot.values()) {
		const distinct = [...new Set(types)].filter((type) => !wildcards.has(type))
		for (let i = 1; i < distinct.length; i++) {
			if (shareSomeMessage(byName.get(distinct[0]), byName.get(distinct[i]))) {
				union(distinct[0], distinct[i])
			}
		}
	}

	/*
	 * 4. entiende todo lo que entiende una familia
	 *
	 * El criterio 2 pide el MISMO conjunto de mensajes, y eso deja afuera al que
	 * sabe hacer algo mas: centralEolica entiende produccionEnergeticaEn y
	 * contamina, como las otras tres centrales, y ademas agregarTurbina. Pero donde
	 * se usa una central se la puede usar a ella: es polimorfica con las otras.
	 *
	 * Vale para una entidad suelta y tambien para una familia entera: si hay dos
	 * centrales eolicas iguales, ya son una familia entre ellas, y las dos juntas
	 * entienden todo lo de las otras centrales.
	 *
	 * Con resguardos, porque coincidir en nombres de mensajes puede ser casualidad:
	 *   - solo sin abstraccion (sin superclase, mixin ni interfaz declarada), de los
	 *     dos lados: si ya hay una, decir quien la cumple es cosa del codigo;
	 *   - la familia a la que se suma tiene al menos dos miembros, y al menos DOS
	 *     mensajes en comun que no sean de los que entiende cualquier objeto o
	 *     cualquier visual de Wollok Game: con uno solo, Turbina (que tambien sabe
	 *     produccionEnergeticaEn) seria una central, y con position() e image()
	 *     cualquier personaje seria un obstaculo;
	 *   - si entra en dos familias que no tienen nada que ver entre si, no se suma a
	 *     ninguna: haria de puente y las juntaria. Si una es un caso particular de
	 *     la otra (su protocolo la contiene), se suma, y quedan las tres juntas;
	 *   - un comodin tampoco se suma, ni la familia donde este: ya se decidio que
	 *     no tiene un rol solo (dos satelitales iguales son una familia, y entienden
	 *     lo de un celular, pero tambien son empresas);
	 *   - una familia que ya cumple un rol propio (un atributo la guarda, como los
	 *     `habitantes` de una casa) no se suma: tiene su interfaz, y fundirla con la
	 *     otra perderia los mensajes que solo ella entiende.
	 * Las familias se miran como quedaron despues del criterio 3, todas a la vez,
	 * asi el resultado no depende del orden. Y se recuerda quien se sumo asi: el
	 * nombre de la interfaz lo ponen los de la familia original (ver
	 * derivedInterfacesOf).
	 */
	const groups = new Map()
	for (const entity of entities) {
		const root = find(entity.name)
		groups.set(root, [...(groups.get(root) ?? []), entity])
	}
	const units = [...groups.values()]
		.filter((members) => !members.some((member) => hasAbstraction(member) || wildcards.has(member.name)))
		.map((members) => ({ root: find(members[0].name), members, protocol: commonProtocolOf(members) }))
	const hasOwnRole = (unit) => unit.members.length > 1
		&& roleNamesOf(unit.members.map((member) => member.name), entities, new Set(wildcards.keys())).length > 0
	const targets = units.filter((unit) => unit.members.length > 1
		&& [...unit.protocol].filter((selector) => !GENERIC_MESSAGES.has(selector)).length >= 2)
	const contains = (outer, inner) => [...inner].every((selector) => outer.has(selector))
	const joins = []
	const joiners = new Set()
	for (const unit of units) {
		if (hasOwnRole(unit)) continue
		const fits = targets.filter((target) => target !== unit && contains(unit.protocol, target.protocol))
		const nested = fits.every((a) => fits.every((b) => contains(a.protocol, b.protocol) || contains(b.protocol, a.protocol)))
		if (!fits.length || !nested) continue
		for (const target of fits) joins.push([target.root, unit.root])
		for (const member of unit.members) joiners.add(member.name)
	}
	for (const [root, other] of joins) union(root, other)
	JOINERS.set(model, joiners)

	return new Map(entities.map((entity) => [entity.name, find(entity.name)]))
}

/**
 * Las familias con mas de un miembro, en orden de aparicion en el codigo.
 * Una entidad sola no es una familia: no hay polimorfismo con nadie.
 *
 * @returns [{ id, members: [nombre], messages: [selector] }]
 */
export const familyGroupsOf = (model) => {
	const family = familiesOf(model)
	const byName = new Map(model.entities.map((entity) => [entity.name, entity]))
	const groups = new Map()
	for (const entity of model.entities) {
		const id = family.get(entity.name)
		groups.set(id, [...(groups.get(id) ?? []), entity.name])
	}
	return [...groups]
		.filter(([, members]) => members.length > 1)
		.map(([id, members]) => ({
			id,
			members,
			// lo que TODOS entienden: es lo que justifica tratarlos igual
			messages: [...members
				.map((name) => selectorsOf(byName.get(name)))
				.reduce((common, messages) => new Set([...common].filter((s) => messages.has(s))))]
				.sort(),
		}))
}

/**
 * A que color le toca cada entidad, para que los DOS diagramas elijan igual.
 *
 * Primero se reparten los grupos polimorficos y despues los individuales: los
 * grupos son lo que importa ver de un vistazo, asi que se llevan los colores
 * mas distinguibles de la paleta. Dentro de cada tanda manda el orden del
 * codigo, asi el resultado es reproducible.
 *
 * El que no es polimorfico con nadie tambien se lleva SU color, distinto al de
 * todos los demas: que dos cosas compartan color tiene que significar que son
 * intercambiables, y nada mas que eso.
 *
 * @returns Map(nombre de entidad -> indice de color)
 */
export const colorIndexOf = (model) => {
	const family = familiesOf(model)
	const members = new Map()
	for (const entity of model.entities) {
		const id = family.get(entity.name)
		members.set(id, [...(members.get(id) ?? []), entity.name])
	}
	const ids = [...members.keys()]
	const ordered = [
		...ids.filter((id) => members.get(id).length > 1),
		...ids.filter((id) => members.get(id).length === 1),
	]

	const index = new Map()
	ordered.forEach((id, position) => {
		for (const name of members.get(id)) index.set(name, position)
	})
	return index
}

// ---------- la interfaz que falta ----------

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const isCollectionType = (type) => /^(List|Set)\b/.test(type ?? '')

/** List<Pertenencia> -> Pertenencia */
const elementTypeOf = (type) => type?.match(/^\w+<(\w+)>$/)?.[1] ?? type

/**
 * El nombre de la interfaz sale del ROL que la familia cumple, o sea del nombre
 * del atributo que la referencia: si juliana y catalina guardan un `celular` que
 * en un caso es samsung y en otro iphone, el concepto se llama Celular. Es el
 * nombre que le pondria una persona, y sale del codigo — no se inventa.
 *
 * Si la referencian con varios nombres distintos gana el mas usado, y a igualdad
 * el que aparece primero. Devuelve todos, en ese orden: si el primero ya es el
 * nombre de otra cosa, se prueba con el siguiente.
 */
const roleNamesOf = (members, entities, ignored = new Set()) => {
	const family = new Set(members)
	const entityNames = new Set(entities.map((entity) => entity.name))
	const counts = new Map()
	const plurals = new Map()
	for (const entity of entities) {
		for (const attribute of entity.attributes) {
			if (attribute.inherited) continue
			// cuenta por su tipo, por lo que recibe (`const empresa` no tiene tipo
			// propio, pero recibe a personal y a movistar) y por sus elementos
			// de una coleccion, lo que se sabe con certeza es lo que tiene adentro; su tipo
			// sale solo del primer elemento
			const receives = (attribute.elements?.length
				? attribute.elements
				: [elementTypeOf(attribute.type), ...(attribute.slotTypes ?? []).map(elementTypeOf)])
				.filter((type) => entityNames.has(type) && !ignored.has(type))
			if (!receives.some((type) => family.has(type))) continue
			const isCollection = isCollectionType(attribute.type) || Boolean(attribute.elements?.length)
			// una coleccion mezclada no es el rol de ninguna de las familias que tiene
			// adentro (un comodin no cuenta: ya se sabe que esta en dos lados)
			if (isCollection && !receives.every((type) => family.has(type))) continue
			// una coleccion guarda muchos: `ciudades` es el rol ciudad; un `equipo` no
			// dice que guarda
			const name = isCollection ? singularRoleOf(attribute.name) : attribute.name
			if (!name) continue
			counts.set(name, (counts.get(name) ?? 0) + 1)
			if (isCollection && !plurals.has(name)) plurals.set(name, attribute.name)
		}
	}
	const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name)
	// el plural queda de ultimo recurso, por si el singular ya es de otra entidad
	return [...ranked, ...ranked.filter((name) => plurals.has(name)).map((name) => plurals.get(name))].map(capitalize)
}

/*
 * El nombre del rol cuando nadie guarda a la familia en un atributo: se busca en
 * los PARAMETROS que la reciben.
 *
 *   paquete.podesSerEntregadoPor(unMensajero, unaUbicacion)
 *       unaUbicacion.dejasPasarA(unMensajero)
 *   brooklyn.dejasPasarA(unMensajero)    ->  unMensajero.peso()
 *   matrix.dejasPasarA(unMensajero)      ->  unMensajero.podesLlamar()
 *
 * `unMensajero` es un rol, Mensajero, y todo lo que se le manda en cualquier metodo
 * es lo que ese rol tiene que saber hacer: peso() y podesLlamar(). La familia
 * {chuck, lincoln, neo} entiende las dos cosas, asi que es de ahi que sale su
 * nombre. Igual que con un atributo, el nombre sale del codigo: no se inventa.
 *
 * Un rol que cumplen DOS familias no nombra a ninguna: elegir una seria tirar una
 * moneda. Y si una familia cumple varios roles, gana el que mas le pide, y a
 * igualdad el que mas se usa.
 *
 * @param parameterRoles  Map(nombre del rol -> { messages: Set(selector), sites })
 */
const parameterRoleNameOf = (group, eligible, parameterRoles, byName) => {
	const understands = (candidate, role) => candidate.members.every((member) => {
		const own = new Set(byName.get(member).messages
			.map((message) => `${message.name}/${message.parameters.length}`))
		return [...role.messages].every((selector) => own.has(selector))
	})
	const matches = [...parameterRoles]
		.filter(([, role]) => understands(group, role))
		.filter(([, role]) => eligible.filter((candidate) => understands(candidate, role)).length === 1)
	if (!matches.length) return undefined
	matches.sort((a, b) => b[1].messages.size - a[1].messages.size || b[1].sites - a[1].sites)
	return matches[0][0]
}

/**
 * Las interfaces que el codigo no declara pero el diagrama pide a gritos.
 *
 * Se agrega una caja «interface» por cada familia polimorfica que:
 *   - todavia no cuelgue de ninguna abstraccion (si ya hay superclase o una
 *     interfaz declarada, esa ES la abstraccion: agregar otra seria ruido);
 *   - tenga al menos un mensaje en comun (una interfaz vacia no dice nada);
 *   - tenga de donde sacar un nombre honesto: un atributo que la guarde, o si no
 *     un parametro que la reciba y le mande mensajes (ver parameterRoleNameOf).
 *
 * La familia que no cumple ningun rol queda sin interfaz — en dual, {juliana,
 * catalina} son polimorficas entre si pero nada las recibe. Quedan igual pintadas
 * del mismo color, que ya dice lo que hay que decir.
 *
 * @param options.parameterRoles  los roles de los parametros, de extract.mjs
 * @returns [{ name, members, operations }]
 */
/** Los tipos de Wollok: una interfaz deducida no puede llamarse asi. */
const WOLLOK_TYPES = ['Object', 'Number', 'String', 'Boolean', 'List', 'Set', 'Dictionary', 'Collection',
	'Date', 'Range', 'Closure', 'Pair', 'Exception', 'Error']

export const derivedInterfacesOf = (model, { parameterRoles = new Map() } = {}) => {
	const byName = new Map(model.entities.map((entity) => [entity.name, entity]))
	const taken = new Set([
		...model.entities.map((entity) => entity.name),
		...model.interfaces.map((entity) => entity.name),
		...WOLLOK_TYPES,
	])

	const eligible = familyGroupsOf(model).filter((group) =>
		group.messages.length && !group.members.some((name) => hasAbstraction(byName.get(name))))

	// El nombre lo ponen los de la familia original: el que se sumo por entender
	// todo (criterio 4) solo cuenta si ellos no tienen ninguno. Una region que
	// tambien sabe produccionEnergeticaEn no hace que las centrales se llamen Region.
	const joiners = JOINERS.get(model) ?? new Set()
	const ignored = new Set(wildcardsOf(model).keys())
	const namesOf = (group) => {
		const core = group.members.filter((member) => !joiners.has(member))
		return roleNamesOf(core.length ? core : group.members, model.entities, ignored)
	}

	// Primero el nombre por atributo, que es el mas claro. Recien despues, entre las
	// familias que quedaron SIN nombre, el que sale de un parametro: la ambiguedad
	// solo se cuenta entre ellas. Una familia que ya se llama Celular por su
	// atributo no compite por el rol de `unaPersona`, aunque tambien entienda llamar().
	const byAttribute = new Map(eligible.map((group) => [group, namesOf(group)]))
	const unnamed = eligible.filter((group) => !byAttribute.get(group).length)

	const derived = []
	for (const group of eligible) {
		const candidates = [...byAttribute.get(group), parameterRoleNameOf(group, unnamed, parameterRoles, byName)]
		const name = candidates.find((candidate) => candidate && !taken.has(candidate))
		if (!name) continue
		taken.add(name)

		// Se reusan las operaciones del primer miembro, no se arman de cero: asi la
		// interfaz muestra los nombres de parametro y los tipos que ya se dedujeron.
		const common = new Set(group.messages)
		const operations = byName.get(group.members[0]).operations
			.filter((operation) => common.has(`${operation.name}/${operation.parameters.length}`))

		derived.push({ name, members: group.members, operations })
	}
	return derived
}
