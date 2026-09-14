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
import { routeReferences } from './routing.mjs'
import { colorsFor } from './colors.mjs'
import { textsFor } from './texts.mjs'

const PADLOCK = '🔒'
const REFERENCE_COLOR = '#000000'   // por defecto, toda referencia sale negra
const CONST_COLOR = '#FF0000'       // con --refcolors: lo que no cambia
const VAR_COLOR = '#009900'         // con --refcolors: lo que sí cambia

// Todo el diagrama va en 14: objetos, referencias, globales y el ambiente.
const FONT_SIZE = 14

// El ambiente es un rectángulo y nada más: NO es un contenedor de draw.io. Como
// contenedor complicaba la edición a mano — al arrastrar un objeto para afuera
// draw.io lo re-parentaba y le reescribía la geometría. Ahora es un dibujo que va
// atrás de todo (se emite primero) y los objetos son hermanos suyos, con
// coordenadas absolutas.
const AMBIENTE_STYLE = `rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;spacingTop=2;fillColor=none;strokeColor=#000000;fontSize=${FONT_SIZE};`

// el grosor del borde de los óvalos y círculos de los objetos, en puntos
const OBJECT_STROKE = 'strokeWidth=2;'
const OBJECT_STYLE = `ellipse;whiteSpace=wrap;html=1;fontSize=${FONT_SIZE};${OBJECT_STROKE}`
// aspect=fixed para que el círculo siga siendo un círculo si lo redimensionás
const CIRCLE_STYLE = `ellipse;whiteSpace=wrap;html=1;fontSize=${FONT_SIZE};aspect=fixed;${OBJECT_STROKE}`
const GLOBAL_STYLE = `text;html=1;align=%ALIGN%;verticalAlign=middle;resizable=1;points=[];fontSize=${FONT_SIZE};fontStyle=0;`

const CAPTION_STYLE = `text;html=1;align=left;verticalAlign=top;fontFamily=Courier New;fontSize=${FONT_SIZE};spacingLeft=4;`

const CAPTION_GAP = 22
const CAPTION_LINE_HEIGHT = 22
const FAILURE_COLOR = '#FF0000'   // la ✗ y el mensaje de una línea del .wrepl que falló

/**
 * El candado pegado al nombre marca que la referencia es `const`.
 *
 * Es el que LLEVA el dato, porque por defecto las referencias son todas negras:
 * "juliana🔒" dice a la vez quién es y que no va a cambiar, y se lee igual
 * impreso en blanco y negro o si uno es daltónico. Con --refcolors el color lo
 * dice también, y con --hidepadlock queda solamente el color.
 *
 * El `name &&` es por los rótulos vacíos: los elementos de un Set salen sin
 * nombre, y un candado solo, sin nada que candar, no diría nada.
 *
 * Ojo: esto es el texto DIBUJADO, no el id de la celda. Los ids se arman con el
 * nombre pelado, que es lo que hace que las posiciones movidas a mano sobrevivan
 * a prender o apagar el candado.
 */
const withPadlock = (name, constant, padlock) => (name && constant && padlock ? `${name}${PADLOCK}` : name)

/**
 * El color de una referencia, para la flecha y para su nombre, que van siempre
 * del mismo color.
 *
 * Por defecto TODAS son negras. El color ya significa otra cosa en este dibujo:
 * el relleno de cada objeto dice a qué familia polimórfica pertenece, y pintar
 * además las flechas competía con eso. La const y la var se distinguen por el
 * candado, que no gasta color.
 *
 * Con --refcolors vuelve la convención vieja: rojo lo que no cambia (una `const`,
 * o el nombre de un object, que es una const en los hechos) y verde lo que sí
 * (una `var`).
 */
const colorFor = (constant, refColors) =>
	(refColors ? (constant ? CONST_COLOR : VAR_COLOR) : REFERENCE_COLOR)

const edgeStyle = (constant, refColors) => {
	const color = colorFor(constant, refColors)
	return `edgeStyle=none;html=1;rounded=1;endArrow=classic;endFill=1;endSize=8;strokeWidth=1.6;strokeColor=${color};fontColor=${color};fontSize=${FONT_SIZE};labelBackgroundColor=#FFFFFF;`
}

const escapeXml = (text) => String(text)
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/*
 * El pie de la secuencia: las líneas del .wrepl que armaron la página.
 *
 * Una línea que falló se muestra igual, y DEBAJO, corrida hacia la derecha para
 * que se lea como parte de ella, una ✗ con el mensaje del error en rojo:
 *
 *    2:  juliana.volar()
 *        ✗ a Persona does not understand volar()        <- en rojo
 *
 * El mensaje va en su propio renglón porque los de Wollok suelen ser largos, y al
 * lado de la línea dejaban el pie mucho más ancho que el dibujo.
 *
 * La celda es html=1, así que el texto se escapa DOS veces: primero como HTML
 * (una línea con `a<b` se leería como una etiqueta <b>) y después todo junto
 * como XML, para el atributo. Las comillas no hace falta escaparlas en HTML, y no
 * se tocan: así una línea sin `& < >` queda exactamente como antes.
 */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// lo que ocupa el "12:  " de adelante; en HTML los espacios seguidos se juntan
const FAILURE_INDENT = '&nbsp;'.repeat(5)

const captionRowsOf = (lines) => lines.flatMap((line) => [
	escapeHtml(line.text),
	...(line.error ? [`${FAILURE_INDENT}<font color="${FAILURE_COLOR}">✗ ${escapeHtml(line.error)}</font>`] : []),
])

const objectId = (id) => `obj::${id}`
const GLOBAL_PREFIX = 'global::'
const globalId = (name) => `${GLOBAL_PREFIX}${name}`

const vertex = (id, value, style, geometry, parent = '1', visible = true) => [
	`        <mxCell id="${escapeXml(id)}" value="${value}" style="${style}" vertex="1"${visible ? '' : ' visible="0"'} parent="${escapeXml(parent)}">`,
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

const buildPage = ({ model, lines, name, index }, { ambiente, positions, globals, colors, showEnv, padlock, refColors, language, warnings }) => {
	/*
	 * El rectangulo del ambiente se dibuja solo con --showenv, pero la celda se
	 * emite SIEMPRE, invisible cuando no se pide.
	 *
	 * No es capricho: es el ANCLA del merge. Los objetos se guardan con
	 * coordenadas absolutas y el layout trabaja en coordenadas relativas al
	 * ambiente, asi que al regenerar hay que restarle su origen; y ademas, si
	 * moviste el rectangulo a mano, es ahi donde quedo anotado. Si la celda
	 * desapareciera del archivo, cada regeneracion correria todo un poco.
	 *
	 * Con visible="0" draw.io no lo dibuja ni lo deja seleccionar, y readGeometry
	 * lo sigue leyendo.
	 */
	// el id sigue siendo 'ambiente' en cualquier idioma: es el ancla de las posiciones
	// guardadas, y cambiarlo al cambiar de idioma perderia lo acomodado a mano
	const ambienteLabel = textsFor(language).environment
	const cells = [...vertex('ambiente', escapeXml(ambienteLabel), AMBIENTE_STYLE, ambiente, '1', showEnv === true)]

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

	// --- el ruteo ---
	// Se calcula de una sola vez para TODAS las flechas —las de entre objetos y
	// las que entran desde un nombre global—, porque las dos cruzan el mismo
	// dibujo y tienen que esquivar los mismos objetos (ver routing.mjs).
	const centerOf = (id) => {
		const position = positions.get(id)
		if (position) {
			return {
				x: ambiente.x + position.x + position.width / 2,
				y: ambiente.y + position.y + position.height / 2,
			}
		}
		// un nombre global vive afuera del ambiente, en coordenadas absolutas
		const label = globals.get(id.startsWith(GLOBAL_PREFIX) ? id.slice(GLOBAL_PREFIX.length) : id)
		return label && { x: label.x + label.width / 2, y: label.y + label.height / 2 }
	}
	const shapes = model.objects.flatMap((object) => {
		const center = centerOf(object.id)
		if (!center) return []
		const position = positions.get(object.id)
		return [{ id: object.id, ...center, width: position.width, height: position.height, ellipse: isCircle(object) }]
	})
	// primero las referencias y despues las globales: asi el indice de una
	// referencia sigue siendo su posicion en model.references
	const globalEdges = model.globals
		.filter((global) => globals.has(global.name))
		.map((global) => ({ from: `${GLOBAL_PREFIX}${global.name}`, to: global.to, global }))
	const { waypoints, stubborn } = routeReferences([...model.references, ...globalEdges], centerOf, shapes)

	// --- las referencias globales: un texto afuera y una flecha que entra ---
	globalEdges.forEach(({ global }, index) => {
		const position = globals.get(global.name)
		const color = colorFor(global.constant, refColors)
		const style = GLOBAL_STYLE.replace('%ALIGN%', position.align ?? 'left')
		const name = withPadlock(global.name, global.constant, padlock)
		cells.push(...vertex(globalId(global.name), escapeXml(name), `${style}fontColor=${color};`, position))
		cells.push(...edge(`edge::global::${global.name}`, '', edgeStyle(global.constant, refColors),
			globalId(global.name), objectId(global.to), waypoints.get(model.references.length + index)))
	})

	// --- las referencias entre objetos ---
	for (const index of stubborn) {
		const reference = model.references[index]
		// Todas las páginas comparten un layout, así que el mismo caso aparecería
		// una vez por página: se avisa una sola.
		warnings?.add(`${reference.from} -> ${reference.to}${reference.label ? ` (${reference.label})` : ''}: no encontré por dónde esquivarla sin dar una vuelta enorme, así que queda cruzando algún objeto`)
	}
	model.references.forEach((reference, position) => {
		cells.push(...edge(
			`edge::${reference.from}::${reference.label || position}::${reference.to}`,
			withPadlock(reference.label, reference.constant, padlock),
			edgeStyle(reference.constant, refColors),
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
	const routingWarnings = new Set()
	// El layout también tiene que saberlo: el candado ensancha el rótulo, y de ese
	// ancho dependen la separación entre dos rótulos del mismo borde y el lugar que
	// el ambiente les deja.
	const padlock = settings.showPadlock !== false
	const placement = {
		...layout(union, previous, padlock),
		colors: colorsFor(union, settings.colorIndex, { palette: settings.palette }),
		showEnv: settings.showEnv === true,
		padlock,
		refColors: settings.refColors === true,
		language: settings.language,
		warnings: routingWarnings,
	}

	const pageCells = pages.flatMap((page, index) => buildPage({ ...page, index: index + 1 }, placement))
	if (routingWarnings.size) settings.report?.({ warnings: [...routingWarnings] })

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		...settings.header.map((line) => `<!-- ${line} -->`),
		'<mxfile host="wollokdd2drawio" type="device" compressed="false">',
		...pageCells,
		'</mxfile>',
	].join('\n') + '\n'
}

/** El diagrama de un solo estado: una página, sin pie. */
export const renderObjectDiagram = (model, options = {}) =>
	renderPages([{ model, lines: [], name: options.name ?? textsFor(options.language).objectDiagram }], options)

/** La secuencia completa: una página por paso, con las líneas al pie. */
export const renderSequence = (pages, options = {}) => renderPages(pages, options)
