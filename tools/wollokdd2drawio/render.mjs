/*
 * Del modelo de objetos a un archivo .drawio (XML de mxGraph).
 *
 * Estructura de cada página:
 *
 *   root
 *   ├── ambiente            (rectángulo, va primero: se dibuja atrás de todo)
 *   ├── obj::neo            (elipse, coordenadas absolutas)
 *   ├── obj::chuck
 *   ├── global::chuck       (texto, afuera)
 *   ├── edge de global::chuck a obj::chuck
 *   ├── edges entre objetos
 *   └── pie                 (con --genseq: las líneas que se ejecutaron)
 *
 * Todo cuelga de la raíz: el ambiente es un dibujo, no un contenedor, así que
 * editarlo a mano no re-parenta nada.
 *
 * Los ids son estables — el camino desde el global que llega al objeto — así se
 * puede regenerar el diagrama sin perder lo que acomodaste a mano.
 *
 * Un archivo puede tener VARIAS páginas (con --genseq, una por paso). Todas
 * comparten el mismo layout, calculado sobre la unión de todos los pasos: si no,
 * los objetos saltarían de lugar entre página y página y no se vería qué cambió.
 */

import { layout, isCircle } from './layout.mjs'
import { colorsFor } from './colors.mjs'

const CONST_COLOR = '#FF0000'
const VAR_COLOR = '#009900'

// Todo el diagrama va en 14: objetos, referencias, globales y el ambiente.
const FONT_SIZE = 14

// El ambiente es un rectángulo y nada más: NO es un contenedor de draw.io. Como
// contenedor complicaba la edición a mano — al arrastrar un objeto para afuera
// draw.io lo re-parentaba y le reescribía la geometría. Ahora es un dibujo que va
// atrás de todo (se emite primero) y los objetos son hermanos suyos, con
// coordenadas absolutas.
const AMBIENTE_STYLE = `rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;spacingTop=2;fillColor=none;strokeColor=#000000;fontSize=${FONT_SIZE};`

const OBJECT_STYLE = `ellipse;whiteSpace=wrap;html=1;fontSize=${FONT_SIZE};`
// aspect=fixed para que el círculo siga siendo un círculo si lo redimensionás
const CIRCLE_STYLE = `ellipse;whiteSpace=wrap;html=1;fontSize=${FONT_SIZE};aspect=fixed;`
const GLOBAL_STYLE = `text;html=1;align=%ALIGN%;verticalAlign=middle;resizable=1;points=[];fontSize=${FONT_SIZE};fontStyle=0;`
const CAPTION_STYLE = `text;html=1;align=left;verticalAlign=top;fontFamily=Courier New;fontSize=${FONT_SIZE};spacingLeft=4;`

const CAPTION_GAP = 22
const CAPTION_LINE_HEIGHT = 22

const edgeStyle = (constant) => {
	const color = constant ? CONST_COLOR : VAR_COLOR
	return `edgeStyle=none;html=1;rounded=1;endArrow=classic;endFill=1;endSize=8;strokeWidth=1.6;strokeColor=${color};fontColor=${color};fontSize=${FONT_SIZE};labelBackgroundColor=#FFFFFF;`
}

const escapeXml = (text) => String(text)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Texto de varias líneas para una celda con html=1. */
const multiline = (lines) => lines.map(escapeXml).join('&lt;br&gt;')

const objectId = (id) => `obj::${id}`
const globalId = (name) => `global::${name}`

const vertex = (id, value, style, geometry, parent = '1') => [
	`        <mxCell id="${escapeXml(id)}" value="${value}" style="${style}" vertex="1" parent="${escapeXml(parent)}">`,
	`          <mxGeometry x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" as="geometry" />`,
	'        </mxCell>',
]

const edge = (id, value, style, source, target, waypoint) => [
	`        <mxCell id="${escapeXml(id)}" value="${escapeXml(value)}" style="${style}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}">`,
	...(waypoint
		? [
			'          <mxGeometry relative="1" as="geometry">',
			'            <Array as="points">',
			`              <mxPoint x="${waypoint.x}" y="${waypoint.y}" />`,
			'            </Array>',
			'          </mxGeometry>',
		]
		: ['          <mxGeometry relative="1" as="geometry" />']),
	'        </mxCell>',
]

/** Separación entre dos flechas que unen el mismo par de objetos. */
const PARALLEL_GAP = 30

/**
 * Dos referencias pueden unir EL MISMO par de objetos. Pasa siempre que una
 * colección repite un elemento: en `[1,2,3,3]` los índices 2 y 3 son el MISMO
 * objeto 3 —Wollok no crea dos— así que salen dos flechas del mismo origen al
 * mismo destino. Dibujadas rectas se superponen perfectamente y se ve una sola,
 * con un solo rótulo: el otro índice desaparece.
 *
 * Por eso se las abre en abanico. Cada una pasa por un punto corrido
 * PERPENDICULARMENTE al segmento que une los dos centros, repartido de forma
 * simétrica: con dos flechas una se va para un lado y la otra para el otro. Como
 * el estilo lleva `rounded=1`, el quiebre se ve como un arco.
 *
 * El rótulo lo pone draw.io en el medio del recorrido, o sea justo en ese punto,
 * así que los rótulos también quedan separados.
 *
 * @param centerOf  (id del objeto) -> { x, y } absoluto, o undefined
 * @returns Map(indice de la referencia -> punto por el que tiene que pasar)
 */
const fanOutParallels = (references, centerOf) => {
	const groups = new Map()
	references.forEach((reference, index) => {
		const key = `${reference.from}|${reference.to}`
		groups.set(key, [...(groups.get(key) ?? []), index])
	})

	const waypoints = new Map()
	for (const indexes of groups.values()) {
		if (indexes.length < 2) continue
		const from = centerOf(references[indexes[0]].from)
		const to = centerOf(references[indexes[0]].to)
		if (!from || !to) continue

		const [dx, dy] = [to.x - from.x, to.y - from.y]
		const length = Math.hypot(dx, dy) || 1
		const perpendicular = { x: -dy / length, y: dx / length }
		const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }

		indexes.forEach((index, i) => {
			const shift = (i - (indexes.length - 1) / 2) * PARALLEL_GAP
			// con una cantidad impar, la del medio no se corre: se deja recta en vez
			// de darle un punto que cae justo sobre la recta y que solo estorbaria
			// si despues movieras una caja a mano
			if (!shift) return
			waypoints.set(index, {
				x: Math.round(middle.x + perpendicular.x * shift),
				y: Math.round(middle.y + perpendicular.y * shift),
			})
		})
	}
	return waypoints
}

// ---------- la unión de todos los pasos ----------

/**
 * Un modelo con TODO lo que aparece en cualquier paso. Se usa solo para calcular
 * el layout y los colores una vez, y que no se muevan entre páginas.
 */
const unionOf = (models) => {
	const objects = new Map()
	const references = new Map()
	const globals = new Map()
	for (const model of models) {
		for (const object of model.objects) if (!objects.has(object.id)) objects.set(object.id, object)
		for (const reference of model.references) references.set(`${reference.from}|${reference.label}|${reference.to}`, reference)
		for (const global of model.globals) if (!globals.has(global.name)) globals.set(global.name, global)
	}
	return {
		objects: [...objects.values()],
		references: [...references.values()],
		globals: [...globals.values()],
		warnings: [],
	}
}

// ---------- una página ----------

const buildPage = ({ model, lines, name, index }, { ambiente, positions, globals, colors }) => {
	const cells = [...vertex('ambiente', escapeXml('Ambiente'), AMBIENTE_STYLE, ambiente)]

	// --- los objetos, dibujados adentro del rectángulo ---
	// El layout los ubica relativos al ambiente; acá se pasan a absolutos, porque
	// son hermanos del rectángulo y no sus hijos.
	for (const object of model.objects) {
		const position = positions.get(object.id)
		if (!position) continue
		const { fill, stroke } = colors.get(object.id)
		const shape = isCircle(object) ? CIRCLE_STYLE : OBJECT_STYLE
		cells.push(...vertex(objectId(object.id), escapeXml(object.label),
			`${shape}fillColor=${fill};strokeColor=${stroke};`,
			{ ...position, x: ambiente.x + position.x, y: ambiente.y + position.y }))
	}

	// --- las referencias globales: un texto afuera y una flecha que entra ---
	for (const global of model.globals) {
		const position = globals.get(global.name)
		if (!position) continue
		const color = global.constant ? CONST_COLOR : VAR_COLOR
		const style = GLOBAL_STYLE.replace('%ALIGN%', position.align ?? 'left')
		cells.push(...vertex(globalId(global.name), escapeXml(global.name), `${style}fontColor=${color};`, position))
		cells.push(...edge(`edge::global::${global.name}`, '', edgeStyle(global.constant),
			globalId(global.name), objectId(global.to)))
	}

	// --- las referencias entre objetos ---
	// Las que unen el mismo par de objetos se abren en abanico para que no se
	// tapen entre ellas (ver fanOutParallels).
	const centerOf = (id) => {
		const position = positions.get(id)
		return position && {
			x: ambiente.x + position.x + position.width / 2,
			y: ambiente.y + position.y + position.height / 2,
		}
	}
	const waypoints = fanOutParallels(model.references, centerOf)
	model.references.forEach((reference, position) => {
		cells.push(...edge(
			`edge::${reference.from}::${reference.label || position}::${reference.to}`,
			reference.label,
			edgeStyle(reference.constant),
			objectId(reference.from),
			objectId(reference.to),
			waypoints.get(position),
		))
	})

	// --- el pie: las líneas que se ejecutaron ---
	if (lines?.length) {
		cells.push(...vertex('lineas', multiline(lines), CAPTION_STYLE, {
			x: ambiente.x,
			y: ambiente.y + ambiente.height + CAPTION_GAP,
			width: Math.max(ambiente.width, 420),
			height: lines.length * CAPTION_LINE_HEIGHT,
		}))
	}

	return [
		`  <diagram id="paso-${index}" name="${escapeXml(name)}">`,
		'    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">',
		'      <root>',
		'        <mxCell id="0" />',
		'        <mxCell id="1" parent="0" />',
		...cells,
		'      </root>',
		'    </mxGraphModel>',
		'  </diagram>',
	]
}

// ---------- el archivo ----------

/**
 * @param pages  [{ model, lines, name }] — una sola para el diagrama suelto,
 *               varias con --genseq
 */
export const renderPages = (pages, options = {}) => {
	const settings = { header: [], previousGeometry: new Map(), colorIndex: new Map(), ...options }

	// Las cajas se guardan con el prefijo obj:: pero el layout trabaja con el id pelado
	// y con coordenadas relativas al ambiente, así que hay que traducirlas.
	//
	// Un archivo viejo puede tener los objetos colgados del ambiente (cuando era un
	// contenedor) y por lo tanto ya relativos: esos se dejan como están.
	const ambienteBefore = settings.previousGeometry.get('ambiente')
	const previous = new Map()
	for (const [key, geometry] of settings.previousGeometry) {
		if (!key.startsWith('obj::')) { previous.set(key, geometry); continue }
		const alreadyRelative = geometry.parent === 'ambiente'
		previous.set(key.slice(5), alreadyRelative || !ambienteBefore
			? geometry
			: { ...geometry, x: geometry.x - ambienteBefore.x, y: geometry.y - ambienteBefore.y })
	}

	// Un solo layout y una sola paleta para todas las páginas: así los objetos no
	// se mueven ni cambian de color de un paso al siguiente.
	const union = unionOf(pages.map((page) => page.model))
	const placement = { ...layout(union, previous), colors: colorsFor(union, settings.colorIndex) }

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		...settings.header.map((line) => `<!-- ${line} -->`),
		'<mxfile host="wollokdd2drawio" type="device" compressed="false">',
		...pages.flatMap((page, index) => buildPage({ ...page, index: index + 1 }, placement)),
		'</mxfile>',
	].join('\n') + '\n'
}

/** El diagrama de un solo estado: una página, sin pie. */
export const renderObjectDiagram = (model, options = {}) =>
	renderPages([{ model, lines: [], name: options.name ?? 'Diagrama de objetos' }], options)

/** La secuencia completa: una página por paso, con las líneas al pie. */
export const renderSequence = (pages, options = {}) => renderPages(pages, options)
