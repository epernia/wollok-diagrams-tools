/*
 * Inferencia de tipos.
 *
 * Wollok no declara tipos, asi que los deducimos del codigo. El orden de
 * prioridad, de mas fuerte a mas debil, es:
 *
 *   1. La anotacion @UmlType / @UmlReturns escrita en el .wlk
 *   2. El diccionario "types" del sidecar .uml.json (por nombre de referencia)
 *   3. La estructura del codigo (literales, new, mensajes conocidos, self.m())
 *   4. Una heuristica por nombre (pertenencia -> Pertenencia, unaMedida -> Medida)
 *
 * Lo que no se puede deducir se deja sin tipo y se reporta como advertencia,
 * para saber donde conviene agregar una anotacion.
 */

const COMPARISON_MESSAGES = new Set(['>', '<', '>=', '<=', '==', '!=', '===', '!==', '&&', '||', 'and', 'or', 'not', 'negate'])
const ARITHMETIC_MESSAGES = new Set(['-', '*', '/', '%', '**'])

const NUMBER_MESSAGES = new Set([
	'size', 'length', 'abs', 'max', 'min', 'sum', 'count', 'roundUp', 'round',
	'truncate', 'div', 'rem', 'squareRoot', 'invert', 'gcd', 'indexOf', 'sumBy',
])
const BOOLEAN_MESSAGES = new Set([
	'isEmpty', 'notEmpty', 'contains', 'any', 'all', 'between', 'even', 'odd',
	'startsWith', 'endsWith', 'equals', 'isInteger', 'isNumber',
])
const STRING_MESSAGES = new Set([
	'toString', 'printString', 'substring', 'replace', 'trim', 'toUpperCase',
	'toLowerCase', 'join', 'concat',
])
const LIST_MESSAGES = new Set([
	'map', 'filter', 'sortedBy', 'copy', 'asList', 'withoutDuplicates', 'flatMap',
	'take', 'drop', 'reverse', 'values', 'keys',
])
const ADD_MESSAGES = new Set(['add', 'addAll', 'push'])

/*
 * Mensajes que, SOBRE UNA COLECCION, devuelven uno de sus elementos y no un numero:
 * `centrales.max({ central => central.produccionPara(self) })` devuelve una central.
 *
 * Que el receptor sea una coleccion es lo que los distingue: `5.max(3)` y
 * `diametro.min(tamanio)` son numeros y siguen valiendo Number.
 */
const ELEMENT_MESSAGES = new Set(['max', 'min', 'anyOne', 'find', 'findOrDefault', 'findOrElse', 'first', 'last', 'head'])

const ARTICLES = ['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
	'otro', 'otra', 'otros', 'otras', 'nuevo', 'nueva', 'a', 'an', 'the', 'my', 'some', 'other', 'another']

const decapitalize = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/** unaMedida -> medida | elCelular -> celular | pertenencia -> pertenencia */
export const withoutArticle = (name) => {
	for (const article of ARTICLES) {
		if (name.startsWith(article) && name.length > article.length) {
			const rest = name.slice(article.length)
			if (rest[0] === rest[0].toUpperCase()) return decapitalize(rest)
		}
	}
	return name
}

const singular = (name) => (name.endsWith('s') && name.length > 3 ? name.slice(0, -1) : name)

/**
 * El singular en castellano, para NOMBRAR un rol a partir de una coleccion:
 * `ciudades` guarda ciudades, asi que el rol es Ciudad.
 *
 *   ciudades -> ciudad    centrales -> central   camiones -> camion
 *   luces -> luz          turbinas -> turbina    nombres -> nombre
 *   paises -> pais
 *
 * Un sustantivo que termina en consonante hace el plural con -es, y en castellano
 * esa consonante es casi siempre d, l, n, r o y, despues de una vocal. Si no, el
 * plural es con -s (nombres: la r va despues de una b, asi que es nombre-s).
 * Es una regla, no un diccionario: `meses` da `mese` y `cines` da `cin`. Por eso
 * el nombre de una interfaz deducida es una sugerencia: si no te gusta, declarala
 * con @UmlImplements y el nombre lo elegis vos.
 *
 * No reemplaza a `singular`, que se usa para TIPAR por el nombre: ahi un plural
 * mal cortado no encuentra ninguna entidad y no pasa nada, pero uno bien cortado
 * le daria tipo de elemento a una coleccion.
 */
export const singularOf = (name) => {
	if (!name.endsWith('s') || name.length <= 3) return name
	if (/[aeiouáéíóú]ces$/i.test(name)) return `${name.slice(0, -3)}z`
	if (/[aeiouáéíóú][dlnry]es$/i.test(name)) return name.slice(0, -2)
	if (/[aeiou][aeiou]ses$/i.test(name)) return name.slice(0, -2)
	return name.slice(0, -1)
}

const ROLE_DETERMINERS = ['todos', 'todas', 'todo', 'toda', 'all', 'every']
const ROLE_PREPOSITIONS = ['de', 'del', 'con', 'en', 'para', 'por', 'sin', 'of', 'in', 'with', 'for']

/**
 * El rol de una coleccion: lo que guarda, en singular. undefined si el nombre no
 * dice que guarda.
 *
 *   ciudades -> ciudad              ciudadesVisitadas -> ciudadVisitada
 *   misCiudades -> ciudad           todasLasCiudades -> ciudad
 *   ciudadesDelPais -> ciudadDelPais (lo que va despues de "de" queda como esta)
 *   listaDeCiudades -> ciudad       (lista no es plural: es el contenedor)
 *   equipo, flota, stock -> undefined (un sustantivo colectivo no nombra a sus
 *                                      elementos: un jugador no es un equipo)
 */
export const singularRoleOf = (name) => {
	let rest = name
	for (let previous; previous !== rest;) {
		previous = rest
		rest = withoutArticle(rest)
		const determiner = ROLE_DETERMINERS.find((word) => rest.startsWith(word) && /[A-Z]/.test(rest[word.length] ?? ''))
		if (determiner) rest = decapitalize(rest.slice(determiner.length))
	}
	const words = rest.split(/(?=[A-Z])/)
	const preposition = words.findIndex((word, index) => index > 0 && ROLE_PREPOSITIONS.includes(word.toLowerCase()))
	const head = preposition < 0 ? words : words.slice(0, preposition)
	const tail = preposition < 0 ? [] : words.slice(preposition)
	const singular = head.map((word) => {
		const cut = singularOf(word.toLowerCase())
		return word[0] === word[0].toUpperCase() ? cut.charAt(0).toUpperCase() + cut.slice(1) : cut
	})
	if (singular.join('') !== head.join('')) return decapitalize([...singular, ...tail].join(''))
	// no habia nada en plural: o es un contenedor (`listaDeCiudades`), o un colectivo
	return tail.length > 1 ? singularRoleOf(decapitalize(tail.slice(1).join(''))) : undefined
}

/*
 * --- nombres que hablan de una cantidad o de una unidad: Number ---
 *
 * `km`, `litros`, `unaCantidad`, `cantidadDeColores`, `tiempo`, `unosSegundos`:
 * nadie guarda un String en una variable que se llama asi. Es el ultimo recurso
 * de la heuristica por nombre: si el nombre coincide con una entidad (una clase
 * `Tiempo`), gana la entidad.
 *
 * El nombre se parte en palabras (camelCase, guion bajo, numeros), sin tildes y
 * sin el articulo del principio, y es Number si:
 *   - la PRIMERA palabra es una cantidad o una unidad: `cantidadDeColores`,
 *     `tiempoDeViaje`, `kmRecorridos` (en castellano el sustantivo va primero);
 *   - o la ULTIMA: `colorCount`, `totalKm` (en ingles va al final);
 *   - o una unidad viene despues de una preposicion: `unNumeroDeKm`,
 *     `consumoPorLitro`, `distanceInMiles`.
 *
 * Las cantidades y medidas cuentan solo en singular: `precio` es un numero, pero
 * `precios` es casi seguro una lista. Las unidades se listan con sus formas, que
 * casi siempre son plurales (`litros`, `horas`), y quedan afuera las que confunden:
 * `segundo` (el segundo jugador), `dia` y `mes` (una fecha, un nombre), `punto`.
 *
 * Y no es Number si la primera palabra dice otra cosa: una coleccion
 * (`listaDeHoras`), una pregunta (`esMayorDeEdad`, `hasTime`) o un texto
 * (`nombreDelMes`, `unidadDeTiempo`). Tampoco si la palabra que habla de la medida
 * es el nombre de una entidad del diagrama: con una clase `Tiempo`,
 * `tiempoGuardado` probablemente sea un Tiempo y no un numero.
 */
const QUANTITIES = new Set([
	// castellano
	'cantidad', 'cant', 'numero', 'nro', 'num', 'total', 'subtotal', 'contador', 'conteo', 'suma',
	'promedio', 'porcentaje', 'proporcion', 'cociente', 'indice', 'max', 'min', 'maximo', 'minimo',
	'limite', 'tope', 'umbral', 'puntaje', 'stock',
	'monto', 'importe', 'precio', 'costo', 'coste', 'tarifa', 'saldo', 'sueldo', 'salario', 'deuda', 'presupuesto',
	'tiempo', 'duracion', 'demora', 'edad', 'peso', 'masa', 'altura', 'alto', 'ancho', 'largo', 'longitud',
	'profundidad', 'espesor', 'grosor', 'distancia', 'velocidad', 'aceleracion', 'temperatura', 'energia',
	'potencia', 'capacidad', 'volumen', 'superficie', 'diametro', 'tamanio', 'tamano', 'presion', 'consumo',
	'rendimiento', 'frecuencia',
	// ingles
	'amount', 'count', 'number', 'total', 'counter', 'sum', 'average', 'avg', 'mean', 'percentage',
	'percent', 'ratio', 'quantity', 'qty', 'index', 'maximum', 'minimum', 'limit', 'threshold', 'score',
	'price', 'cost', 'fee', 'fare', 'balance', 'salary', 'wage', 'debt', 'budget',
	'time', 'duration', 'delay', 'age', 'weight', 'mass', 'height', 'width', 'length', 'depth', 'thickness',
	'distance', 'speed', 'velocity', 'acceleration', 'temperature', 'energy', 'power', 'capacity', 'volume',
	'size', 'diameter', 'pressure', 'consumption', 'frequency', 'rate',
])
const UNITS = new Set([
	// castellano
	'km', 'kms', 'kilometro', 'kilometros', 'metro', 'metros', 'mts', 'cm', 'cms', 'centimetro', 'centimetros',
	'mm', 'milimetro', 'milimetros', 'litro', 'litros', 'lt', 'lts', 'ml', 'mililitro', 'mililitros',
	'gramo', 'gramos', 'gr', 'grs', 'kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'tonelada', 'toneladas',
	'segundos', 'seg', 'segs', 'minuto', 'minutos', 'mins', 'hora', 'horas', 'hs', 'hrs',
	'dias', 'semanas', 'meses', 'anio', 'anios', 'anos', 'grado', 'grados', 'caloria', 'calorias', 'kcal',
	'watt', 'watts', 'volt', 'volts', 'pesos', 'dolares', 'euros', 'puntos', 'veces', 'porciento',
	'byte', 'bytes', 'kb', 'mb', 'gb', 'pixel', 'pixeles', 'px', 'cuotas', 'unidades', 'porciones', 'vueltas',
	// ingles
	'kilometers', 'kilometres', 'meters', 'metres', 'miles', 'feet', 'inches', 'liters', 'litres', 'gallons',
	'grams', 'kilograms', 'pounds', 'lbs', 'ounces', 'oz', 'tons', 'tonnes', 'seconds', 'secs', 'minutes',
	'hour', 'hours', 'days', 'weeks', 'months', 'year', 'years', 'degrees', 'calories', 'dollars',
	'bytes', 'pixels', 'points', 'times', 'laps', 'units',
])
/** Primeras palabras que dicen que NO es un numero, aunque despues venga una unidad. */
const NOT_A_NUMBER = new Set([
	// colecciones
	'lista', 'listado', 'coleccion', 'conjunto', 'historial', 'registro', 'registros', 'diccionario', 'mapa',
	'list', 'collection', 'set', 'array', 'history', 'map', 'dictionary',
	// preguntas: son Boolean
	'es', 'esta', 'estan', 'son', 'tiene', 'tienen', 'puede', 'pueden', 'hay', 'fue', 'debe',
	'is', 'are', 'has', 'have', 'can', 'was', 'should', 'must',
	// textos y cosas que no son cantidades
	'nombre', 'descripcion', 'texto', 'titulo', 'mensaje', 'etiqueta', 'fecha', 'unidad', 'tipo', 'formato',
	'name', 'description', 'text', 'title', 'message', 'label', 'date', 'unit', 'type', 'format',
])
const NUMBER_ARTICLES = new Set([
	'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'lo', 'mi', 'mis', 'su', 'sus', 'tu', 'tus',
	'otro', 'otra', 'otros', 'otras', 'nuevo', 'nueva',
	'a', 'an', 'the', 'my', 'some', 'other', 'new',
])
const PREPOSITIONS = new Set(['de', 'del', 'en', 'por', 'x', 'of', 'in', 'per'])

/** unNumeroDeKm -> [un, numero, de, km] | tamañoDelCandado -> [tamano, del, candado] */
const wordsOf = (name) => (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
	.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [])
	.map((word) => word.toLowerCase())

/**
 * Si el nombre habla de una cantidad o de una unidad: ver el comentario de arriba.
 * @param entityNames  nombres de las entidades, en minusculas: esas palabras no cuentan como medida
 */
export const isNumericName = (name, entityNames = new Set()) => {
	const words = wordsOf(name ?? '')
	while (words.length > 1 && NUMBER_ARTICLES.has(words[0])) words.shift()
	if (!words.length || NOT_A_NUMBER.has(words[0])) return false
	const measures = (word) => (QUANTITIES.has(word) || UNITS.has(word)) && !entityNames.has(word)
	const unit = (word) => UNITS.has(word) && !entityNames.has(word)
	return measures(words[0])
		|| measures(words[words.length - 1])
		|| words.some((word, index) => index > 0 && PREPOSITIONS.has(words[index - 1]) && unit(word))
}

export const isCollectionType = (type) => /^(List|Set)\b/.test(type ?? '')
export const elementTypeOf = (type) => type?.match(/^(?:List|Set)<(.+)>$/)?.[1]

/**
 * Construye el resolvedor de tipos para un modelo ya extraido.
 *
 * @param entityNames  nombres de todas las entidades del diagrama (clases, WKOs,
 *                     mixins e interfaces declaradas con @UmlImplements)
 * @param dictionary   diccionario nombre -> tipo del sidecar
 * @param methodReturnTypeOf  (entityName, methodName) => tipo, para los self.m()
 */
export const createTypeResolver = ({ entityNames, entityAliases = new Map(), dictionary = {}, methodReturnTypeOf }) => {

	const byLowerCase = new Map(entityNames.map((name) => [name.toLowerCase(), name]))

	/** Busca una entidad del modelo que se llame (mas o menos) como la referencia. */
	const typeFromName = (name) => {
		if (!name) return undefined
		const candidates = [name, withoutArticle(name), singular(name), singular(withoutArticle(name))]
		for (const candidate of candidates) {
			const found = byLowerCase.get(candidate.toLowerCase())
			// una referencia a un WKO vale por lo que implementa: `nivel = principiante`
			// es de tipo Nivel, no de tipo principiante
			if (found) return entityAliases.get(found) ?? found
		}
		// ninguna entidad se llama asi: si el nombre habla de una cantidad, es un numero
		return isNumericName(name, new Set(byLowerCase.keys())) ? 'Number' : undefined
	}

	/** Tipo declarado a mano para una referencia: sidecar. */
	const typeFromDictionary = (name) => dictionary[name]

	/**
	 * Tipo de una expresion.
	 * @param scope { entity, localTypes: Map(nombre -> tipo) }
	 */
	const typeOf = (expression, scope, seen = new Set()) => {
		if (!expression) return undefined

		switch (expression.kind) {
			case 'Literal': return typeOfLiteral(expression, scope, seen)
			case 'New': return expression.instantiated?.name
			case 'Self': return scope.entity?.name
			case 'Reference': return typeOfReference(expression.name, scope)
			case 'Send': return typeOfSend(expression, scope, seen)
			case 'If':
				return typeOf(lastSentenceOf(expression.thenBody), scope, seen)
					?? typeOf(lastSentenceOf(expression.elseBody), scope, seen)
			case 'Return': return typeOf(expression.value, scope, seen)
			default: return undefined
		}
	}

	const typeOfLiteral = (literal, scope, seen) => {
		const value = literal.value
		// Las colecciones literales llegan como [Reference(wollok.lang.List), [elementos]]
		if (Array.isArray(value)) {
			const collection = value[0]?.name?.includes('Set') ? 'Set' : 'List'
			const elements = value[1] ?? []
			const elementType = elements.length ? typeOf(elements[0], scope, seen) : undefined
			return elementType ? `${collection}<${elementType}>` : collection
		}
		if (value === null) return undefined
		if (typeof value === 'number') return 'Number'
		if (typeof value === 'string') return 'String'
		if (typeof value === 'boolean') return 'Boolean'
		return undefined
	}

	const typeOfReference = (name, scope) => {
		if (!name) return undefined
		// un parametro o un campo del objeto actual
		const local = scope.localTypes?.get(name)
		if (local) return local
		// una referencia a un objeto well-known: vale su tipo declarado o su nombre
		return typeFromDictionary(name) ?? typeFromName(name)
	}

	const typeOfSend = (send, scope, seen) => {
		const message = send.message

		if (COMPARISON_MESSAGES.has(message)) return 'Boolean'
		if (ARITHMETIC_MESSAGES.has(message)) return 'Number'
		if (message === '+') {
			// puede ser suma o concatenacion de strings
			const receiverType = typeOf(send.receiver, scope, seen)
			const argumentType = typeOf(send.args?.[0], scope, seen)
			return receiverType === 'String' || argumentType === 'String' ? 'String' : 'Number'
		}
		// el elemento que sale de una coleccion vale lo que valen sus elementos; si no
		// se sabe de que son, mejor sin tipo que con uno inventado
		if (ELEMENT_MESSAGES.has(message)) {
			const collection = typeOf(send.receiver, scope, seen)
			if (isCollectionType(collection)) return elementTypeOf(collection)
		}
		if (NUMBER_MESSAGES.has(message)) return 'Number'
		if (BOOLEAN_MESSAGES.has(message)) return 'Boolean'
		if (STRING_MESSAGES.has(message)) return 'String'
		if (LIST_MESSAGES.has(message)) return 'List'

		// self.metodo() / otroObjeto.metodo(): vamos a buscar que devuelve ese metodo
		const receiverType = typeOf(send.receiver, scope, seen)
		const target = elementTypeOf(receiverType) ?? receiverType
		if (!target) return undefined
		const key = `${target}#${message}`
		if (seen.has(key)) return undefined   // corta la recursion mutua
		seen.add(key)
		return methodReturnTypeOf?.(target, message, seen)
	}

	const lastSentenceOf = (body) => body?.sentences?.[body.sentences.length - 1]

	/**
	 * Tipo de elemento de una coleccion vacia: se busca que le agregan.
	 * Ej: `botin.add(pertenencia)` dentro de robar(pertenencia) => Pertenencia
	 */
	const elementTypeFromAdds = (fieldName, entityNode, scope) => {
		for (const method of entityNode.methods ?? []) {
			for (const send of method.descendants ?? []) {
				if (send.kind !== 'Send' || !ADD_MESSAGES.has(send.message)) continue
				if (send.receiver?.kind !== 'Reference' || send.receiver.name !== fieldName) continue
				const localTypes = new Map(scope.localTypes)
				for (const parameter of method.parameters ?? []) {
					localTypes.set(parameter.name, typeFromDictionary(parameter.name) ?? typeFromName(parameter.name))
				}
				const found = typeOf(send.args?.[0], { ...scope, localTypes })
				// addAll recibe una coleccion: el elemento es lo que tiene adentro
				const element = send.message === 'addAll' ? elementTypeOf(found) : found
				if (element) return element
			}
		}
		return undefined
	}

	return { typeOf, typeFromName, typeFromDictionary, elementTypeFromAdds }
}
