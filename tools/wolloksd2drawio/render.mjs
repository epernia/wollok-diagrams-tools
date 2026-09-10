/*
 * Del modelo UML intermedio a un archivo .drawio (XML de mxGraph).
 *
 * Se genera sin comprimir (compressed="false"), asi el archivo es texto plano:
 * entra en git, se puede diffear y lo puede leer cualquiera.
 *
 * Cada caja es un swimlane con childLayout=stackLayout, que es la forma en que
 * draw.io representa una clase UML: el titulo arriba, una fila por atributo, una
 * linea separadora y una fila por metodo. Se puede editar celda por celda desde
 * la interfaz.
 *
 * Los ids son estables (el nombre de la entidad, no un uuid nuevo cada vez): esa
 * es la clave para poder regenerar el diagrama sin perder lo que acomodaste a
 * mano (ver mergeGeometry).
 */

import { layout, sizeOf, headerHeightOf, rowHeightOf } from './layout.mjs'
import { routeAll, collisionsOf } from './routing.mjs'
import { readGeometry } from '../wollok-uml/drawio-merge.mjs'
import { colorIndexOf } from '../wollok-uml/families.mjs'
import { colorAt } from '../wollok-uml/palette.mjs'

export { readGeometry }

const PALETTE = {
	class: 'fillColor=#FFFFFF;strokeColor=#34495E;',
	// el mismo naranja que el spot << (O,#FF7700) WKO >> del PlantUML
	wko: 'fillColor=#FFE6CC;strokeColor=#D79B00;',
	interface: 'fillColor=#DAE8FC;strokeColor=#6C8EBF;',
	mixin: 'fillColor=#E1D5E7;strokeColor=#9673A6;',
}

/**
 * De que color va cada caja. La regla es una sola: MISMO COLOR = MISMA FAMILIA
 * POLIMORFICA. El que no es polimorfico con nadie tambien recibe su propio
 * color, distinto al de todos los demas.
 *
 * El reparto lo decide el nucleo (families.mjs), no este archivo, y por eso el
 * diagrama de objetos puede elegir exactamente los mismos colores: los dos
 * preguntan lo mismo al mismo lugar.
 *
 * @returns Map(nombre de entidad -> estilo de relleno y borde)
 */
const familyColorsOf = (model) => {
	const styleOf = (index) => {
		const color = colorAt(index)
		return `fillColor=${color.fill};strokeColor=${color.stroke};`
	}
	const colors = new Map()
	for (const [name, index] of colorIndexOf(model)) colors.set(name, styleOf(index))

	// La caja de una interfaz va del color de quienes la implementan: es la
	// cabeza de esa familia, no una cosa aparte. Vale igual para las que
	// declaraste vos y para las que dedujo la herramienta.
	for (const entity of model.interfaces) {
		const implementor = model.entities.find((candidate) => candidate.interfaces.includes(entity.name))
		const style = implementor && colors.get(implementor.name)
		if (style) colors.set(entity.name, style)
	}
	return colors
}

const STEREOTYPE_LABELS = { class: '«class»', wko: '«WKO»', interface: '«interface»', mixin: '«mixin»' }

/** En Wollok una clase es abstracta si le queda algun metodo sin cuerpo. */
const stereotypeLabelOf = (entity) =>
	entity.kind === 'class' && entity.isAbstract ? '«abstract class»' : STEREOTYPE_LABELS[entity.kind]

const BOX_STYLE = 'swimlane;html=1;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;horizontalStack=0;resizeParent=1;resizeParentMax=0;collapsible=0;marginBottom=0;'
const ROW_STYLE = 'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=6;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;'
const SEPARATOR_STYLE = 'line;html=1;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;'
const NOTE_STYLE = 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;fillColor=#FCF3CF;strokeColor=#B7950B;size=18;align=left;verticalAlign=top;spacingLeft=6;'
const NOTE_LINK_STYLE = 'endArrow=none;dashed=1;html=1;strokeColor=#B7950B;'

/*
 * Las puntas de cada tipo de flecha. Van SIN `edgeStyle`: el recorrido lo
 * calcula routing.mjs y se emite como waypoints, asi la geometria es exacta y
 * verificable. Con `edgeStyle=orthogonalEdgeStyle` los waypoints pasan a ser
 * meras sugerencias y el ruteador agrega quiebres propios.
 */
const EDGE_STYLES = {
	inheritance: 'endArrow=block;endFill=0;endSize=14;html=1;rounded=0;',
	realization: 'endArrow=block;endFill=0;endSize=14;dashed=1;html=1;rounded=0;',
	mixin: 'endArrow=block;endFill=0;endSize=14;dashed=1;html=1;rounded=0;',
	association: 'endArrow=open;endFill=0;endSize=12;html=1;rounded=0;',
	aggregation: 'endArrow=open;endFill=0;endSize=12;startArrow=diamondThin;startFill=0;startSize=16;html=1;rounded=0;',
	composition: 'endArrow=open;endFill=0;endSize=12;startArrow=diamondThin;startFill=1;startSize=16;html=1;rounded=0;',
	dependency: 'endArrow=open;endFill=0;endSize=12;dashed=1;html=1;rounded=0;',
}

const SIDE_X = { left: 0, right: 1 }

const STRUCTURAL = ['inheritance', 'realization', 'mixin']

const slug = (text) => String(text).normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

const escapeXml = (text) => String(text)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// ---------- el contenido de cada caja ----------

const attributeText = (attribute, options) => {
	const mutability = options.showMutability && !attribute.inherited ? `${attribute.mutability} ` : ''
	const type = attribute.type ? ` : ${attribute.type}` : ''
	const value = attribute.defaultValue !== undefined ? ` = ${attribute.defaultValue}` : ''
	return `${attribute.visibility} ${mutability}${attribute.name}${type}${value}`
}

const operationText = (operation) => {
	const parameters = operation.parameters
		.map((parameter) => (parameter.type ? `${parameter.name} : ${parameter.type}` : parameter.name))
		.join(', ')
	return `+ ${operation.name}(${parameters})${operation.returns ? ` : ${operation.returns}` : ''}`
}

const boxOf = (entity, options) => {
	const attributes = options.showAttributes
		? entity.attributes.filter((a) => options.associations !== 'arrow' || !a.isRelation)
		: []
	const operations = options.showOperations ? entity.operations : []

	const rows = [
		...attributes.map((attribute, index) => ({
			id: `attr:${attribute.name}:${index}`, kind: 'row', text: attributeText(attribute, options),
		})),
		...(attributes.length && operations.length ? [{ id: 'separator', kind: 'separator', text: '' }] : []),
		...operations.map((operation, index) => ({
			id: `op:${operation.name}:${index}`, kind: 'row', text: operationText(operation),
		})),
	]

	const label = stereotypeLabelOf(entity)
	const stereotypes = [
		...(label ? [label] : []),
		...entity.stereotypes.map((stereotype) => `«${stereotype}»`),
	]

	const box = {
		name: entity.name,
		kind: entity.kind,
		stereotypes,
		rows,
		headerHeight: headerHeightOf(entity),
	}
	return { ...box, ...sizeOf(box) }
}

// ---------- las celdas ----------

const boxCells = (box, position, familyColors = new Map()) => {
	const title = box.stereotypes.length
		? `${box.stereotypes.join(' ')}&lt;br&gt;&lt;b&gt;${escapeXml(box.name)}&lt;/b&gt;`
		: escapeXml(box.name)

	const cells = [
		`        <mxCell id="${escapeXml(box.name)}" value="${title}" style="${BOX_STYLE}startSize=${box.headerHeight};${familyColors.get(box.name) ?? PALETTE[box.kind] ?? PALETTE.class}" vertex="1" parent="1">`,
		`          <mxGeometry x="${position.x}" y="${position.y}" width="${box.width}" height="${box.height}" as="geometry" />`,
		'        </mxCell>',
	]

	let y = box.headerHeight
	for (const row of box.rows) {
		const height = rowHeightOf(row)
		const style = row.kind === 'separator' ? SEPARATOR_STYLE : ROW_STYLE
		cells.push(
			`        <mxCell id="${escapeXml(`${box.name}::${row.id}`)}" value="${escapeXml(row.text)}" style="${style}" vertex="1" parent="${escapeXml(box.name)}">`,
			`          <mxGeometry y="${y}" width="${box.width}" height="${height}" as="geometry" />`,
			'        </mxCell>',
		)
		y += height
	}
	return cells
}

/** En UML la flecha de herencia va del hijo al padre; en el modelo esta al reves. */
const endpointsOf = (relation) => STRUCTURAL.includes(relation.kind)
	? { source: relation.to, target: relation.from }
	: { source: relation.from, target: relation.to }

/*
 * Un rotulo de arista se centra en el punto del recorrido, asi que sin
 * desplazarlo queda PISANDO la linea. El `offset` lo corre en pixeles: negativo
 * en Y lo sube. Como todos los rotulos se ponen sobre tramos horizontales (ver
 * labelPositionOf y las puntas, que salen y entran de costado), subirlos alcanza
 * para que la linea quede libre.
 */
const LABEL_LIFT = 11          // el nombre de la referencia, arriba del tramo
const MULTIPLICITY_LIFT = 9    // las multiplicidades, un poco mas pegadas

const edgeLabel = (id, parentId, text, position, lift) => [
	`        <mxCell id="${escapeXml(id)}" value="${escapeXml(text)}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="${escapeXml(parentId)}">`,
	`          <mxGeometry x="${position}" relative="1" as="geometry">`,
	`            <mxPoint y="${-lift}" as="offset" />`,
	'          </mxGeometry>',
	'        </mxCell>',
]

/** La celda de la fila del atributo del que sale la flecha, si es que se dibujo. */
const attributeRowIdOf = (box, attributeName) => {
	if (!box || !attributeName) return undefined
	const row = box.rows.find((r) => r.kind === 'row' && r.id.startsWith(`attr:${attributeName}:`))
	return row ? `${box.name}::${row.id}` : undefined
}

/*
 * Los anclajes. Ojo con la trampa de mxGraph: los cuatro valores (exitX, exitY,
 * exitDx, exitDy) van SIEMPRE juntos. Si falta uno, mxGraph descarta el punto
 * entero y la arista vuelve a ser flotante.
 *
 *   punto absoluto = caja.x + exitX * caja.ancho + exitDx
 *                    caja.y + exitY * caja.alto  + exitDy
 *
 * Por eso el desplazamiento va en PIXELES (exitDy) y no como fraccion: asi no se
 * corre cuando la caja crece al agregarle un metodo.
 */
const anchorsOf = (route, sourceIsRow) => {
	if (route.structural) {
		// hijo: sale por el borde de arriba. padre: entra por el de abajo.
		return 'exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;'
	}
	const exit = sourceIsRow
		// la celda de la fila mide lo mismo de ancho que la caja, asi que su
		// costado es el costado de la caja, y su centro es el centro de la fila
		? `exitX=${SIDE_X[route.exitSide]};exitY=0.5;exitDx=0;exitDy=0;`
		: `exitX=${SIDE_X[route.exitSide]};exitY=0;exitDx=0;exitDy=${round(route.exitOffset)};`
	return `${exit}entryX=${SIDE_X[route.entrySide]};entryY=0;entryDx=0;entryDy=${round(route.entryOffset)};`
}

const round = (value) => Math.round(value * 100) / 100

/**
 * Donde poner el nombre del atributo sobre la flecha. La posicion de un rotulo
 * en draw.io va de -1 (pegado al origen) a 1 (pegado al destino), medida sobre
 * el LARGO del recorrido. Se busca el tramo HORIZONTAL mas largo y se devuelve
 * su punto medio: si se dejara en el medio del recorrido, en una ruta en Z caeria
 * sobre el tramo vertical del pasillo y quedaria ilegible.
 */
const labelPositionOf = (route) => {
	const points = [route.exit, ...route.points, route.entry]
	const lengths = points.slice(0, -1).map((point, i) =>
		Math.abs(points[i + 1].x - point.x) + Math.abs(points[i + 1].y - point.y))
	const total = lengths.reduce((sum, length) => sum + length, 0)
	if (!total) return -0.55

	let run = 0
	let best
	let longest = 0
	points.slice(0, -1).forEach((point, i) => {
		const horizontal = Math.abs(points[i + 1].y - point.y) < 0.5
		if (horizontal && lengths[i] > longest) {
			longest = lengths[i]
			best = run + lengths[i] / 2
		}
		run += lengths[i]
	})
	if (best === undefined) return -0.55
	return round(Math.max(-0.9, Math.min(0.9, (best / total) * 2 - 1)))
}

const edgeCells = (route, boxesByName) => {
	const { relation, index } = route
	const { source, target } = endpointsOf(relation)
	const id = `edge::${relation.kind}::${source}::${target}::${index}`

	// La flecha arranca en la celda de la FILA del atributo: asi sale a la altura
	// donde esta declarado. Si esa fila no se dibujo (--associations=arrow, o
	// --no-attributes), se cae a la caja con el desplazamiento en pixeles.
	const rowId = route.structural
		? undefined
		: attributeRowIdOf(boxesByName.get(relation.from), relation.fromAttribute)
	const sourceId = rowId ?? source

	const waypoints = route.points.length
		? [
			'          <mxGeometry relative="1" as="geometry">',
			'            <Array as="points">',
			...route.points.map((point) => `              <mxPoint x="${round(point.x)}" y="${round(point.y)}" />`),
			'            </Array>',
			'          </mxGeometry>',
		]
		: ['          <mxGeometry relative="1" as="geometry" />']

	const style = `${EDGE_STYLES[relation.kind] ?? EDGE_STYLES.association}${anchorsOf(route, Boolean(rowId))}`
	const cells = [
		`        <mxCell id="${escapeXml(id)}" style="${style}" edge="1" parent="1" source="${escapeXml(sourceId)}" target="${escapeXml(target)}">`,
		...waypoints,
		'        </mxCell>',
	]
	// El nombre del atributo va sobre el PRIMER tramo (el horizontal que sale de
	// la caja), no en el medio del recorrido: en una ruta en Z el medio cae sobre
	// el tramo vertical del pasillo y queda ilegible.
	if (relation.label && !route.structural) {
		cells.push(...edgeLabel(`${id}::label`, id, relation.label, labelPositionOf(route), LABEL_LIFT))
	}
	// las multiplicidades van pegadas a cada punta
	if (relation.fromMultiplicity) cells.push(...edgeLabel(`${id}::from`, id, relation.fromMultiplicity, -0.9, MULTIPLICITY_LIFT))
	if (relation.toMultiplicity) cells.push(...edgeLabel(`${id}::to`, id, relation.toMultiplicity, 0.9, MULTIPLICITY_LIFT))
	return cells
}

const noteCells = (note, index, position, size) => {
	const id = `note::${note.target}::${index}`
	const html = escapeXml(String(note.text)).split('\n').join('&lt;br&gt;')
	return [
		`        <mxCell id="${escapeXml(id)}" value="${html}" style="${NOTE_STYLE}" vertex="1" parent="1">`,
		`          <mxGeometry x="${position.x}" y="${position.y}" width="${size.width}" height="${size.height}" as="geometry" />`,
		'        </mxCell>',
		`        <mxCell id="${escapeXml(`${id}::link`)}" style="${NOTE_LINK_STYLE}" edge="1" parent="1" source="${escapeXml(id)}" target="${escapeXml(note.target)}">`,
		'          <mxGeometry relative="1" as="geometry" />',
		'        </mxCell>',
	]
}

const NOTE_WIDTH = 260
const noteSizeOf = (note) => ({
	width: NOTE_WIDTH,
	height: Math.max(60, String(note.text).split('\n').length * 17 + 24),
})

const NOTE_GAP = 40

/**
 * Al lado de la caja a la que apunta, del lado que diga la nota — pero
 * buscando un lugar LIBRE: se prueba el lado pedido y despues los otros,
 * alejandose de a poco, hasta encontrar un hueco donde la nota no se encime con
 * ninguna caja ni con otra nota. Antes iba a un offset fijo y terminaba tapando
 * cosas, y ademas las flechas le pasaban por encima.
 */
const notePositionOf = (note, anchor, size, occupied) => {
	if (!anchor) return { x: 40, y: 40 }
	const { x, y, width, height } = anchor
	const sides = [note.position ?? 'right', 'right', 'left', 'bottom', 'top']
	const free = (candidate) => !occupied.some((rect) =>
		candidate.x < rect.x + rect.width && candidate.x + size.width > rect.x
		&& candidate.y < rect.y + rect.height && candidate.y + size.height > rect.y)

	for (let step = 0; step < 6; step++) {
		const away = NOTE_GAP + step * (NOTE_GAP + 20)
		for (const side of sides) {
			const candidate = {
				top: { x, y: y - size.height - away },
				bottom: { x, y: y + height + away },
				left: { x: x - size.width - away, y },
				right: { x: x + width + away, y },
			}[side]
			if (candidate && free(candidate)) return candidate
		}
	}
	return { x: x + width + NOTE_GAP, y }
}

// ---------- el archivo ----------

export const renderDrawio = (model, options = {}) => {
	const settings = {
		name: 'Diagrama de clases',
		showAttributes: true,
		showOperations: true,
		showMutability: true,
		showFamilies: true,
		associations: 'both',
		header: [],
		previousGeometry: new Map(),
		...options,
	}

	// las interfaces primero: son las que van arriba de todo
	const entities = [...model.interfaces, ...model.entities]
	const boxes = entities.map((entity) => boxOf(entity, settings))
	const positions = layout(boxes, model.relations, settings.previousGeometry)

	// Las notas se ubican ANTES de rutear: ocupan lugar en el dibujo, asi que el
	// ruteo tiene que esquivarlas igual que a las cajas.
	const placedBoxes = boxes
		.filter((box) => positions.has(box.name))
		.map((box) => ({ name: box.name, ...positions.get(box.name), width: box.width, height: box.height }))

	// El hueco entre un padre y sus hijos esta reservado para el peine de flechas
	// de herencia. Si una nota se mete ahi, el tronco no tiene por donde pasar.
	const rectFor = (name) => placedBoxes.find((box) => box.name === name)
	const trunkBands = model.relations.flatMap((relation) => {
		if (!STRUCTURAL.includes(relation.kind)) return []
		const parent = rectFor(relation.from)
		const child = rectFor(relation.to)
		if (!parent || !child || child.y <= parent.y + parent.height) return []
		const [a, b] = [parent.x + parent.width / 2, child.x + child.width / 2].sort((p, q) => p - q)
		return [{
			name: `trunk::${relation.from}::${relation.to}`,
			x: a - 10, y: parent.y + parent.height,
			width: (b - a) + 20, height: child.y - (parent.y + parent.height),
		}]
	})
	// Se recorren en orden y cada una ve las que ya se ubicaron, para no pisarse
	// entre ellas tampoco.
	const notes = []
	const noteRects = []
	model.notes.forEach((note, index) => {
		const size = noteSizeOf(note)
		const anchor = positions.has(note.target)
			? { ...positions.get(note.target), ...boxes.find((box) => box.name === note.target) }
			: undefined
		const previous = settings.previousGeometry.get(`note::${note.target}::${index}`)
		const position = previous ?? notePositionOf(note, anchor, size, [...placedBoxes, ...trunkBands, ...noteRects])
		notes.push({ note, index, size, position })
		noteRects.push({
			name: `note::${note.target}::${index}`,
			x: position.x, y: position.y, width: size.width, height: size.height,
			right: position.x + size.width, bottom: position.y + size.height,
		})
	})

	// El recorrido de cada flecha se calcula sobre la geometria final, de modo que
	// tambien sale bien cuando las cajas vienen movidas a mano del archivo anterior.
	const { routes, warnings, rects } = routeAll(boxes, model.relations, positions, noteRects)
	const boxesByName = new Map(boxes.map((box) => [box.name, box]))
	const collisions = routes.reduce((total, route) => total + collisionsOf(route, rects).length, 0)
	settings.report?.({ warnings, collisions, edges: routes.length })

	// Un color por familia polimórfica, salvo que se pida lo contrario.
	const familyColors = settings.showFamilies === false ? new Map() : familyColorsOf(model)

	const cells = []
	for (const box of boxes) cells.push(...boxCells(box, positions.get(box.name), familyColors))
	for (const route of routes) cells.push(...edgeCells(route, boxesByName))
	for (const { note, index, size, position } of notes) {
		cells.push(...noteCells(note, index, position, size))
	}

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		...settings.header.map((line) => `<!-- ${line} -->`),
		'<mxfile host="wolloksd2drawio" type="device" compressed="false">',
		`  <diagram id="${slug(settings.name)}" name="${escapeXml(settings.name)}">`,
		'    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">',
		'      <root>',
		'        <mxCell id="0" />',
		'        <mxCell id="1" parent="0" />',
		...cells,
		'      </root>',
		'    </mxGraphModel>',
		'  </diagram>',
		'</mxfile>',
	].join('\n') + '\n'
}
