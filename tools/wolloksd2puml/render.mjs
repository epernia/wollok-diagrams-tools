/*
 * Del modelo UML intermedio al texto PlantUML, con las convenciones que venimos
 * usando en la materia:
 *
 *   - class "X" as X                         para clases
 *   - abstract class "X" as X                para las abstractas (en Wollok, las
 *                                            que tienen algun metodo sin cuerpo)
 *   - class "x" as x << (O,#FF7700) WKO >>   para los objetos well-known
 *   - interface "X" as X <<interface>>       para las interfaces (que en Wollok
 *                                            no existen: se declaran con
 *                                            @UmlImplements)
 *   - atributos tipados, con const/var adelante
 *   - visibilidad + para las properties (generan accesores) y - para el resto
 */

import { entityColorsOf } from '../wollok-uml/entity-colors.mjs'
import { typeColorOf, valueColorOf, mutabilityColorOf } from '../wollok-uml/palette.mjs'
import { messagesFor } from '../wollok-uml/i18n.mjs'

/** Lo que este modulo escribe por su cuenta en el archivo. Mismas claves en los dos idiomas. */
const MESSAGES = {
	en: {
		// el nombre del diagrama cuando no hay archivo de salida
		defaultName: 'class-diagram',
		// los comentarios que separan las secciones del .puml
		relationsSection: 'relationships',
		notesSection: 'notes',
	},
	es: {
		defaultName: 'diagrama-de-clases',
		relationsSection: 'relaciones',
		notesSection: 'notas',
	},
}

const DEFAULT_SKINPARAMS = [
	'skinparam classAttributeIconSize 0',
	'skinparam shadowing false',
	'skinparam linetype ortho',
	'skinparam class {',
	'    BackgroundColor White',
	'    BorderColor #34495E',
	'    ArrowColor #34495E',
	'    StereotypeFontColor #7F8C8D',
	'}',
	'skinparam note {',
	'    BackgroundColor #FCF3CF',
	'    BorderColor #B7950B',
	'}',
]

const SPOTS = {
	wko: '<< (O,#FF7700) WKO >>',
	mixin: '<< (M,#8E44AD) mixin >>',
}

const ARROWS = {
	inheritance: (r) => `${r.from} <|-- ${r.to}`,
	realization: (r) => `${r.from} <|.. ${r.to}`,
	mixin: (r) => `${r.from} <|.. ${r.to}`,
	association: (r) => arrow(r, '-->'),
	aggregation: (r) => arrow(r, 'o-->'),
	composition: (r) => arrow(r, '*-->'),
	dependency: (r) => arrow(r, '..>'),
}

const arrow = (relation, symbol) => {
	const from = relation.fromMultiplicity ? `${relation.from} "${relation.fromMultiplicity}"` : relation.from
	const to = relation.toMultiplicity ? `"${relation.toMultiplicity}" ${relation.to}` : relation.to
	return `${from} ${symbol} ${to}${relation.label ? ` : ${relation.label}` : ''}`
}

/*
 * Los mismos colores que en draw.io (ver CODE_COLORS en palette.mjs): el tipo, en
 * italica, el valor inicial y las palabras const/var. PlantUML entiende <color> e
 * <i> adentro de los miembros de una clase, sigue reconociendo la visibilidad del
 * principio, y un generico como `List<Pertenencia>` se sigue viendo tal cual:
 * <Pertenencia> no es un tag suyo.
 */
const colored = (text, color) => `<color:${color}>${text}</color>`
const typeText = (type) => `<i>${colored(type, typeColorOf(type))}</i>`

const attributeLine = (attribute, options) => {
	const mutability = options.showMutability && !attribute.inherited
		? `${colored(attribute.mutability, mutabilityColorOf(attribute.mutability))} `
		: ''
	const type = attribute.type ? ` : ${typeText(attribute.type)}` : ''
	const value = attribute.defaultValue !== undefined
		? ` = ${colored(attribute.defaultValue, valueColorOf(attribute.defaultValue))}`
		: ''
	return `    ${attribute.visibility} ${mutability}${attribute.name}${type}${value}`
}

/*
 * Igual que en draw.io: un metodo que redefine al de arriba lleva ⬆️ adelante, y en
 * la caja de una interfaz no se pone.
 *
 *   ⬆️ + llamar( unaDuracion : Number )
 *
 * Con el emoji adelante, PlantUML deja de dibujar el + como su iconito de
 * visibilidad y lo escribe tal cual, que es justo como se pidio que se lea.
 *
 * Con parametros, un espacio adentro de cada parentesis: `volar( kms : Number )`.
 * Sin parametros, pegados: `volar()`.
 */
const OVERRIDE_MARK = '⬆️'

const operationLine = (operation, showOverride) => {
	const parameters = operation.parameters
		.map((p) => (p.type ? `${p.name} : ${typeText(p.type)}` : p.name))
		.join(', ')
	const returns = operation.returns ? ` : ${typeText(operation.returns)}` : ''
	const mark = showOverride && operation.override ? `${OVERRIDE_MARK} ` : ''
	return `    ${mark}+ ${operation.name}(${parameters ? ` ${parameters} ` : ''})${returns}`
}

/*
 * El color va DESPUES de los estereotipos y antes de la llave, que es donde lo
 * espera PlantUML: `class "Foo" as Foo <<WKO>> #7CC0D8 {`.
 *
 * Solo el relleno. draw.io ademas pinta el borde de cada caja con un tono mas
 * oscuro; aca el borde queda el mismo para todas (el BorderColor de los
 * skinparams). La familia la dice el relleno, que es lo que coincide con draw.io
 * y con el diagrama de objetos.
 */
const entityBlock = (entity, options, color) => {
	// En Wollok una clase es abstracta si le queda algun metodo sin cuerpo.
	// PlantUML lo dibuja en cursiva, que es la convencion de UML.
	const keyword = entity.kind === 'interface' ? 'interface'
		: entity.kind === 'class' && entity.isAbstract ? 'abstract class'
			: 'class'
	const stereotypes = [
		...(SPOTS[entity.kind] ? [SPOTS[entity.kind]] : []),
		...(entity.kind === 'interface' ? ['<<interface>>'] : []),
		...entity.stereotypes.map((s) => `<<${s}>>`),
	].join(' ')

	const attributes = options.showAttributes
		? entity.attributes.filter((a) => options.associations !== 'arrow' || !a.isRelation).map((a) => attributeLine(a, options))
		: []
	const operations = options.showOperations
		? entity.operations.map((operation) => operationLine(operation, entity.kind !== 'interface'))
		: []

	const body = [...attributes, ...(attributes.length && operations.length ? ['    --'] : []), ...operations]

	const fill = color ? ` ${color.fill}` : ''
	const header = `${keyword} "${entity.name}" as ${entity.name}${stereotypes ? ` ${stereotypes}` : ''}${fill}`
	return body.length ? [`${header} {`, ...body, '}'] : [`${header} { }`]
}

const noteBlock = (note) => [
	`note ${note.position} of ${note.target}`,
	...String(note.text).split('\n').map((line) => `  ${line}`),
	'end note',
]

export const renderPlantUML = (model, options = {}) => {
	const say = messagesFor(MESSAGES, options.language)
	const settings = {
		title: undefined,
		showAttributes: true,
		showOperations: true,
		showMutability: true,
		associations: 'both',
		skinparams: DEFAULT_SKINPARAMS,
		header: [],
		...options,
		// sin nombre (o con `name: undefined`), el de por defecto en el idioma pedido
		name: options.name ?? say.defaultName,
	}

	const lines = [`@startuml ${settings.name}`]
	for (const line of settings.header) lines.push(`' ${line}`)
	lines.push('')
	if (settings.title) lines.push(`title ${settings.title}`, '')
	lines.push(...settings.skinparams, '')

	// Cada interfaz se emite justo antes de su primer implementador, para que
	// el archivo se lea en el mismo orden que el codigo.
	const interfaces = new Map(model.interfaces.map((i) => [i.name, i]))
	const emitted = new Set()
	const colors = entityColorsOf(model, {
		palette: settings.palette ?? 'wollok',
		showFamilies: settings.showFamilies !== false,
	})

	for (const entity of model.entities) {
		for (const name of entity.interfaces) {
			if (interfaces.has(name) && !emitted.has(name)) {
				emitted.add(name)
				lines.push(...entityBlock(interfaces.get(name), settings, colors.get(name)), '')
			}
		}
		lines.push(...entityBlock(entity, settings, colors.get(entity.name)), '')
	}
	for (const [name, iface] of interfaces) {
		if (!emitted.has(name)) lines.push(...entityBlock(iface, settings, colors.get(name)), '')
	}

	if (model.relations.length) {
		lines.push(`' ---------- ${say.relationsSection} ----------`, '')
		const isStructural = (r) => ['inheritance', 'realization', 'mixin'].includes(r.kind)
		const structural = model.relations.filter(isStructural)
		// con --associations=attribute las relaciones se ven solo como atributos
		const links = settings.associations === 'attribute'
			? []
			: model.relations.filter((r) => !isStructural(r))
		for (const relation of links) lines.push(renderRelation(relation))
		if (links.length && structural.length) lines.push('')
		for (const relation of structural) lines.push(renderRelation(relation))
		lines.push('')
	}

	if (model.notes.length) {
		lines.push(`' ---------- ${say.notesSection} ----------`, '')
		for (const note of model.notes) lines.push(...noteBlock(note), '')
	}

	lines.push('@enduml')
	return lines.join('\n') + '\n'
}

const renderRelation = (relation) => (ARROWS[relation.kind] ?? ARROWS.association)(relation)
