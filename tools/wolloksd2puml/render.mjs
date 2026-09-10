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

const attributeLine = (attribute, options) => {
	const mutability = options.showMutability && !attribute.inherited ? `${attribute.mutability} ` : ''
	const type = attribute.type ? ` : ${attribute.type}` : ''
	const value = attribute.defaultValue !== undefined ? ` = ${attribute.defaultValue}` : ''
	return `    ${attribute.visibility} ${mutability}${attribute.name}${type}${value}`
}

const operationLine = (operation) => {
	const parameters = operation.parameters
		.map((p) => (p.type ? `${p.name} : ${p.type}` : p.name))
		.join(', ')
	const returns = operation.returns ? ` : ${operation.returns}` : ''
	return `    + ${operation.name}(${parameters})${returns}`
}

const entityBlock = (entity, options) => {
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
	const operations = options.showOperations ? entity.operations.map(operationLine) : []

	const body = [...attributes, ...(attributes.length && operations.length ? ['    --'] : []), ...operations]

	const header = `${keyword} "${entity.name}" as ${entity.name}${stereotypes ? ` ${stereotypes}` : ''}`
	return body.length ? [`${header} {`, ...body, '}'] : [`${header} { }`]
}

const noteBlock = (note) => [
	`note ${note.position} of ${note.target}`,
	...String(note.text).split('\n').map((line) => `  ${line}`),
	'end note',
]

export const renderPlantUML = (model, options = {}) => {
	const settings = {
		name: 'diagrama-de-clases',
		title: undefined,
		showAttributes: true,
		showOperations: true,
		showMutability: true,
		associations: 'both',
		skinparams: DEFAULT_SKINPARAMS,
		header: [],
		...options,
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

	for (const entity of model.entities) {
		for (const name of entity.interfaces) {
			if (interfaces.has(name) && !emitted.has(name)) {
				emitted.add(name)
				lines.push(...entityBlock(interfaces.get(name), settings), '')
			}
		}
		lines.push(...entityBlock(entity, settings), '')
	}
	for (const [name, iface] of interfaces) {
		if (!emitted.has(name)) lines.push(...entityBlock(iface, settings), '')
	}

	if (model.relations.length) {
		lines.push("' ---------- relaciones ----------", '')
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
		lines.push("' ---------- notas ----------", '')
		for (const note of model.notes) lines.push(...noteBlock(note), '')
	}

	lines.push('@enduml')
	return lines.join('\n') + '\n'
}

const renderRelation = (relation) => (ARROWS[relation.kind] ?? ARROWS.association)(relation)
