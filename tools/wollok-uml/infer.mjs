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

const ARTICLES = ['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'mi', 'su', 'otro', 'otra', 'nuevo', 'nueva']

const decapitalize = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/** unaMedida -> medida | elCelular -> celular | pertenencia -> pertenencia */
const withoutArticle = (name) => {
	for (const article of ARTICLES) {
		if (name.startsWith(article) && name.length > article.length) {
			const rest = name.slice(article.length)
			if (rest[0] === rest[0].toUpperCase()) return decapitalize(rest)
		}
	}
	return name
}

const singular = (name) => (name.endsWith('s') && name.length > 3 ? name.slice(0, -1) : name)

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
		return undefined
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
				if (found) return found
			}
		}
		return undefined
	}

	return { typeOf, typeFromName, typeFromDictionary, elementTypeFromAdds }
}
