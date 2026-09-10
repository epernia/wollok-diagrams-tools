/*
 * Familias polimorficas del modelo de CLASES.
 *
 * El diagrama de objetos ya las detectaba: al ejecutar el ejemplo se ve que dos
 * objetos ocupan el mismo lugar o entienden los mismos mensajes, y se los pinta
 * del mismo color. El diagrama de clases, en cambio, no infería nada: solo
 * dibujaba una interfaz si vos la declarabas con @UmlImplements o en el sidecar.
 *
 * Aca se portan los mismos tres criterios, pero leyendo el codigo en vez de
 * ejecutarlo. Dos entidades son de la misma familia si:
 *
 *   1. hay herencia, mixin, o las dos declaran la misma interfaz;
 *   2. entienden EXACTAMENTE el mismo conjunto de mensajes;
 *   3. ocupan el mismo lugar, o sea que hay un atributo con el mismo nombre
 *      (`celular` en juliana y en catalina) que en un caso es una y en otro es
 *      la otra — y ademas comparten al menos un mensaje.
 *
 * El criterio 3 es mas flojo que el del diagrama de objetos, que puede mirar que
 * paso de verdad en tiempo de ejecucion. Aca solo se ve el valor inicial de cada
 * atributo, asi que se compara por NOMBRE de atributo entre owners distintos.
 * De ahi el resguardo de exigir un mensaje en comun: sin el, dos entidades que
 * casualmente tienen un atributo `nombre` quedarian emparentadas.
 *
 * Con las familias en la mano se hacen dos cosas: pintarlas del mismo color, y
 * agregar la caja de interfaz que falta (ver derivedInterfacesOf).
 */

/** Los mensajes que entiende una entidad, como `nombre/aridad`. */
const selectorsOf = (entity) =>
	new Set(entity.operations.map((operation) => `${operation.name}/${operation.parameters.length}`))

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
	for (const entity of entities) {
		for (const attribute of entity.attributes) {
			if (attribute.inherited || !attribute.type || !byName.has(attribute.type)) continue
			bySlot.set(attribute.name, [...(bySlot.get(attribute.name) ?? []), attribute.type])
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
	const slotsOf = new Map()
	for (const [slot, types] of bySlot) {
		// un lugar con un solo inquilino no habla de roles
		if (new Set(types).size < 2) continue
		for (const type of new Set(types)) slotsOf.set(type, [...(slotsOf.get(type) ?? []), slot])
	}
	const wildcards = new Map([...slotsOf].filter(([, slots]) => slots.length > 1))
	WILDCARDS.set(model, wildcards)

	for (const types of bySlot.values()) {
		const distinct = [...new Set(types)].filter((type) => !wildcards.has(type))
		for (let i = 1; i < distinct.length; i++) {
			if (shareSomeMessage(byName.get(distinct[0]), byName.get(distinct[i]))) {
				union(distinct[0], distinct[i])
			}
		}
	}

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

/** List<Pertenencia> -> Pertenencia */
const elementTypeOf = (type) => type?.match(/^\w+<(\w+)>$/)?.[1] ?? type

/** Alguno de la familia ya cuelga de una abstraccion dibujada. */
const hasAbstraction = (entity) =>
	Boolean(entity.superclass) || entity.mixins.length > 0 || entity.interfaces.length > 0

/**
 * El nombre de la interfaz sale del ROL que la familia cumple, o sea del nombre
 * del atributo que la referencia: si juliana y catalina guardan un `celular` que
 * en un caso es samsung y en otro iphone, el concepto se llama Celular. Es el
 * nombre que le pondria una persona, y sale del codigo — no se inventa.
 *
 * Si la referencian con varios nombres distintos gana el mas usado, y a igualdad
 * el que aparece primero.
 */
const roleNameOf = (members, entities) => {
	const family = new Set(members)
	const counts = new Map()
	for (const entity of entities) {
		for (const attribute of entity.attributes) {
			if (attribute.inherited) continue
			if (!family.has(elementTypeOf(attribute.type))) continue
			counts.set(attribute.name, (counts.get(attribute.name) ?? 0) + 1)
		}
	}
	if (!counts.size) return undefined
	return capitalize([...counts].sort((a, b) => b[1] - a[1])[0][0])
}

/**
 * Las interfaces que el codigo no declara pero el diagrama pide a gritos.
 *
 * Se agrega una caja «interface» por cada familia polimorfica que:
 *   - todavia no cuelgue de ninguna abstraccion (si ya hay superclase o una
 *     interfaz declarada, esa ES la abstraccion: agregar otra seria ruido);
 *   - tenga al menos un mensaje en comun (una interfaz vacia no dice nada);
 *   - tenga de donde sacar un nombre honesto, o sea que alguien la referencie.
 *
 * Ese ultimo punto deja afuera a las familias que nadie referencia — en
 * celulares_b, {juliana, catalina}. Son polimorficas entre si, pero no cumplen
 * ningun rol en el modelo, asi que no hay nombre que ponerles. Quedan igual
 * pintadas del mismo color, que ya dice lo que hay que decir.
 *
 * @returns [{ name, members, operations }]
 */
export const derivedInterfacesOf = (model) => {
	const byName = new Map(model.entities.map((entity) => [entity.name, entity]))
	const taken = new Set([
		...model.entities.map((entity) => entity.name),
		...model.interfaces.map((entity) => entity.name),
	])

	const derived = []
	for (const group of familyGroupsOf(model)) {
		if (!group.messages.length) continue
		if (group.members.some((name) => hasAbstraction(byName.get(name)))) continue

		const name = roleNameOf(group.members, model.entities)
		if (!name || taken.has(name)) continue
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
