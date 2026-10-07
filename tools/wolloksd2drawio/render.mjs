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
import { entityColorsOf } from '../wollok-uml/entity-colors.mjs'
import { typeColorOf, valueColorOf, mutabilityColorOf } from '../wollok-uml/palette.mjs'
import { messagesFor } from '../wollok-uml/i18n.mjs'
import { relationLabelOf } from '../wollok-uml/relation-labels.mjs'
import { textWidthOf } from '../wollok-uml/text-width.mjs'

export { readGeometry }

/** Lo que este modulo escribe por su cuenta en el archivo. Mismas claves en los dos idiomas. */
const MESSAGES = {
	en: {
		// el nombre de la pestaña cuando no hay titulo ni archivo de salida
		defaultName: 'Class diagram',
	},
	es: {
		defaultName: 'Diagrama de clases',
	},
}

const STEREOTYPE_LABELS = { class: '«class»', wko: '«WKO»', interface: '«interface»', mixin: '«mixin»' }

/** En Wollok una clase es abstracta si le queda algun metodo sin cuerpo. */
const stereotypeLabelOf = (entity) =>
	entity.kind === 'class' && entity.isAbstract ? '«abstract class»' : STEREOTYPE_LABELS[entity.kind]

/** Menos que esto entre dos cajas vecinas ya no deja pasillo para las flechas. */
const CROWDED_GAP = 40

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

/*
 * Una fila se arma con pedazos: texto comun y pedazos pintados (el tipo, el valor
 * inicial, `const`/`var`). De ahi salen dos versiones:
 *   - `text`, el texto plano, que es lo que mide el layout para el ancho de la caja;
 *   - `html`, lo que va en la celda (las filas son html=1), con cada pedazo de su
 *     color (ver CODE_COLORS en palette.mjs) y los tipos en italica.
 *
 * En el html todo se escapa, no solo lo pintado: sin eso `List<Pertenencia>` le
 * llegaba a draw.io como un tag <Pertenencia>. drawio2wollok lee la fila de vuelta
 * sacando los tags y decodificando, asi que ve el mismo texto plano.
 */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const painted = (text, color, { italic = false } = {}) => ({ text: String(text), color, italic })
const typed = (type) => painted(type, typeColorOf(type), { italic: true })

const htmlOf = (piece) => {
	if (typeof piece === 'string') return escapeHtml(piece)
	const colored = `<font color="${piece.color}">${escapeHtml(piece.text)}</font>`
	return piece.italic ? `<i>${colored}</i>` : colored
}

const rowOf = (pieces) => ({
	text: pieces.map((piece) => (typeof piece === 'string' ? piece : piece.text)).join(''),
	html: pieces.map(htmlOf).join(''),
})

const attributeRow = (attribute, options) => {
	const showMutability = options.showMutability && !attribute.inherited
	return rowOf([
		`${attribute.visibility} `,
		...(showMutability ? [painted(attribute.mutability, mutabilityColorOf(attribute.mutability)), ' '] : []),
		attribute.name,
		...(attribute.type ? [' : ', typed(attribute.type)] : []),
		...(attribute.defaultValue !== undefined
			? [' = ', painted(attribute.defaultValue, valueColorOf(attribute.defaultValue))]
			: []),
	])
}

/*
 * Un metodo que redefine al de arriba lleva ⬆️ adelante:
 *
 *   ⬆️ + llamar( unaDuracion : Number )
 *
 * Sale de `override method` en el codigo, no se deduce. En la caja de una interfaz
 * no se pone: sus operaciones son las del primer implementador (ver families.mjs),
 * y que ESE metodo redefina a otro no dice nada de la interfaz.
 *
 * Con parametros, un espacio adentro de cada parentesis: `volar( kms : Number )`.
 * Sin parametros, pegados: `volar()`.
 *
 * Un metodo @UmlPrivate lleva `-` en lugar de `+`, como un atributo sin property.
 */
const OVERRIDE_MARK = '⬆️'

const operationRow = (operation, showOverride) => {
	const parameters = operation.parameters.flatMap((parameter, index) => [
		...(index ? [', '] : []),
		parameter.name,
		...(parameter.type ? [' : ', typed(parameter.type)] : []),
	])
	return rowOf([
		`${showOverride && operation.override ? `${OVERRIDE_MARK} ` : ''}${operation.visibility ?? '+'} ${operation.name}(`,
		...(parameters.length ? [' ', ...parameters, ' '] : []),
		')',
		...(operation.returns ? [' : ', typed(operation.returns)] : []),
	])
}

const boxOf = (entity, options) => {
	const attributes = options.showAttributes
		? entity.attributes.filter((a) => options.associations !== 'arrow' || !a.isRelation)
		: []
	const operations = options.showOperations ? entity.operations : []

	const rows = [
		...attributes.map((attribute, index) => ({
			id: `attr:${attribute.name}:${index}`, kind: 'row', ...attributeRow(attribute, options),
		})),
		...(attributes.length && operations.length ? [{ id: 'separator', kind: 'separator', text: '' }] : []),
		...operations.map((operation, index) => ({
			id: `op:${operation.name}:${index}`, kind: 'row', ...operationRow(operation, entity.kind !== 'interface'),
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

/** @param colors  Map(nombre -> { fill, stroke }) de entityColorsOf, completo */
const boxCells = (box, position, colors) => {
	// Como las filas, el titulo es HTML adentro de un atributo XML: se escapa dos
	// veces. Sin eso, un @UmlStereotype con & o < dejaba un .drawio que no abre.
	const title = box.stereotypes.length
		? `${escapeXml(escapeHtml(box.stereotypes.join(' ')))}&lt;br&gt;&lt;b&gt;${escapeXml(escapeHtml(box.name))}&lt;/b&gt;`
		: escapeXml(box.name)

	const cells = [
		`        <mxCell id="${escapeXml(box.name)}" value="${title}" style="${BOX_STYLE}startSize=${box.headerHeight};fillColor=${colors.get(box.name).fill};strokeColor=${colors.get(box.name).stroke};" vertex="1" parent="1">`,
		`          <mxGeometry x="${position.x}" y="${position.y}" width="${box.width}" height="${box.height}" as="geometry" />`,
		'        </mxCell>',
	]

	let y = box.headerHeight
	for (const row of box.rows) {
		const height = rowHeightOf(row)
		const style = row.kind === 'separator' ? SEPARATOR_STYLE : ROW_STYLE
		cells.push(
			`        <mxCell id="${escapeXml(`${box.name}::${row.id}`)}" value="${escapeXml(row.html ?? row.text)}" style="${style}" vertex="1" parent="${escapeXml(box.name)}">`,
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
const ARROWHEAD = 14           // lo que ocupa el triangulo hueco en la punta (endSize)

// El rotulo es HTML (html=1) adentro de un atributo XML, asi que se escapa dos
// veces: sin eso, draw.io toma `<conoce>` por una etiqueta desconocida y no
// muestra nada.
const edgeLabel = (id, parentId, text, position, lift, dx = 0) => [
	`        <mxCell id="${escapeXml(id)}" value="${escapeXml(escapeHtml(text))}" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="${escapeXml(parentId)}">`,
	`          <mxGeometry x="${position}" relative="1" as="geometry">`,
	`            <mxPoint${dx ? ` x="${round(dx)}"` : ''} y="${round(-lift)}" as="offset" />`,
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

// ---------- el rotulo de cada relacion: <hereda>, <implementa>, <conoce>, <usa> ----------

/*
 * draw.io escribe los rotulos de arista con letra de 11px y fondo blanco, y los
 * ubica en una posicion relativa (-1 en el origen, 1 en el destino) medida sobre el
 * LARGO del recorrido, a la que le suma un corrimiento. Con eso se puede saber de
 * antemano donde va a quedar cada rotulo, y buscarle un lugar donde no pise nada.
 */
const EDGE_LABEL_SCALE = 11 / 12   // text-width.mjs mide a 12px
const EDGE_LABEL_HEIGHT = 13
const LABEL_AIR = 2                // lo minimo que tiene que quedar alrededor de un rotulo
const SIDE_GAP = 6                 // entre un rotulo al costado de un tramo vertical y el tramo
const ALONG = [0.5, 0.35, 0.65, 0.2, 0.8]   // donde se prueba sobre cada tramo, el medio primero

/** Los tramos del recorrido, cada uno con donde empieza medido desde el origen. */
const legsOf = (route) => {
	const path = [route.exit, ...route.points, route.entry]
	let run = 0
	return path.slice(0, -1).map((a, i) => {
		const b = path[i + 1]
		const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
		const leg = { a, b, start: run, length, horizontal: Math.abs(b.y - a.y) < 0.5 }
		run += length
		return leg
	})
}

/** El punto a `run` px del origen, sobre el recorrido. */
const pointAtRun = (legs, run) => {
	for (const [index, leg] of legs.entries()) {
		if (run <= leg.start + leg.length || index === legs.length - 1) {
			const t = leg.length ? Math.max(0, Math.min(1, (run - leg.start) / leg.length)) : 0
			return { x: leg.a.x + (leg.b.x - leg.a.x) * t, y: leg.a.y + (leg.b.y - leg.a.y) * t }
		}
	}
	return legs[0].a
}

const halfWidthOf = (text) => (textWidthOf(text) * EDGE_LABEL_SCALE + 2) / 2

/** El lugar que ocupa un rotulo centrado en `center`, con su aire alrededor. */
const labelRectOf = (text, center) => {
	const [halfWidth, halfHeight] = [halfWidthOf(text) + LABEL_AIR, EDGE_LABEL_HEIGHT / 2 + LABEL_AIR]
	return { left: center.x - halfWidth, right: center.x + halfWidth, top: center.y - halfHeight, bottom: center.y + halfHeight }
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

const legRectOf = (leg) => ({
	left: Math.min(leg.a.x, leg.b.x), right: Math.max(leg.a.x, leg.b.x),
	top: Math.min(leg.a.y, leg.b.y), bottom: Math.max(leg.a.y, leg.b.y),
})

/** La punta de una flecha: los ultimos `size` px del tramo, con su ancho. */
const tipRectOf = (from, to, size) => {
	const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y) || 1
	const [ux, uy] = [(to.x - from.x) / length, (to.y - from.y) / length]
	const base = { x: to.x - ux * size, y: to.y - uy * size }
	const half = size / 2
	return {
		left: Math.min(base.x, to.x) - (uy ? half : 0), right: Math.max(base.x, to.x) + (uy ? half : 0),
		top: Math.min(base.y, to.y) - (ux ? half : 0), bottom: Math.max(base.y, to.y) + (ux ? half : 0),
	}
}

/** Lo que mide el ultimo tramo de una ruta, el que entra a la caja de destino. */
const lastLegOf = (route) => {
	const legs = legsOf(route)
	return legs[legs.length - 1]?.length ?? 0
}

/** El peine al que pertenece una flecha de herencia o realizacion. */
const combOf = (route) => (route.structural ? `${route.relation.kind}::${route.relation.from}` : undefined)

/*
 * Lo que pesa pisar cada cosa. Tapar texto es lo peor despues de meterse en una
 * caja: el rotulo tiene fondo blanco, asi que cruzar una linea la corta pero se
 * sigue leyendo; tapar un nombre, no.
 */
const WEIGHT = { box: 4, text: 3, tip: 2, line: 1 }

/**
 * Todo lo que un rotulo no deberia pisar: las cajas y notas, los rotulos que ya
 * tiene cada flecha (el nombre de la referencia y las multiplicidades), las puntas
 * y los tramos de todas las flechas. Cada cosa con su peso y con su duenio, para
 * poder no contar lo propio.
 */
const obstaclesOf = (routes, rects) => {
	const obstacles = rects.map((rect) => ({ rect: { left: rect.x, right: rect.right, top: rect.y, bottom: rect.bottom }, weight: WEIGHT.box }))
	for (const route of routes) {
		const legs = legsOf(route)
		if (!legs.length) continue
		const total = legs[legs.length - 1].start + legs[legs.length - 1].length
		const owner = combOf(route) ?? route
		const labelAt = (text, position, dy) => {
			const point = pointAtRun(legs, ((position + 1) / 2) * total)
			obstacles.push({ rect: labelRectOf(text, { x: point.x, y: point.y + dy }), weight: WEIGHT.text, owner })
		}
		const { relation } = route
		if (relation.label && !route.structural) labelAt(relation.label, labelPositionOf(route), -LABEL_LIFT)
		if (relation.fromMultiplicity) labelAt(relation.fromMultiplicity, -0.9, -MULTIPLICITY_LIFT)
		if (relation.toMultiplicity) labelAt(relation.toMultiplicity, 0.9, -MULTIPLICITY_LIFT)
		const last = legs[legs.length - 1]
		obstacles.push({ rect: tipRectOf(last.a, last.b, route.structural ? ARROWHEAD : 12), weight: WEIGHT.tip, owner })
		for (const leg of legs) obstacles.push({ rect: legRectOf(leg), weight: WEIGHT.line, owner })
	}
	return obstacles
}

/**
 * Los lugares donde se prueba un rotulo, en orden de preferencia: { position, dx, dy }
 * (la posicion relativa sobre el recorrido y el corrimiento que se le suma).
 *
 *   - En un peine, al costado del tramo que llega al padre, entre el tronco y la
 *     punta del triangulo (o apoyado justo arriba del tronco, si ese hueco es mas
 *     bajo que el rotulo): primero a la izquierda y si no a la derecha, a mas de
 *     media punta del tramo, para no tocar el triangulo. Si de ningun lado hay
 *     lugar, se prueban otras alturas del tramo, y como ultimo recurso centrado
 *     sobre la linea (con fondo blanco, la corta).
 *
 *               △  <- la punta, ARROWHEAD px
 *     <hereda>  │
 *     ┌─────────┴────────┐  <- el tronco
 *   (hijo)             (hijo)
 *
 *   - En las demas, arriba o abajo de un tramo horizontal: primero el lado opuesto
 *     al nombre de la referencia, que va arriba. Los tramos mas largos primero y el
 *     medio de cada tramo primero. Si ninguno sirve, al costado de un tramo
 *     vertical, y si tampoco, un renglon mas lejos de la linea.
 *
 * El primero es siempre el lugar natural: la busqueda solo lo mueve si ahi choca.
 */
const candidatesOf = (route, text) => {
	const legs = legsOf(route)
	const total = legs[legs.length - 1].start + legs[legs.length - 1].length
	const position = (run) => round(Math.max(-0.95, Math.min(0.95, total ? (run / total) * 2 - 1 : 0)))
	const half = halfWidthOf(text)
	if (route.structural) {
		const last = legs[legs.length - 1]
		// lo que se aparta del tramo: media punta mas el aire, asi no roza el triangulo
		const clearance = ARROWHEAD / 2 + LABEL_AIR + 1
		const aside = (side) => (last.horizontal
			? { dx: 0, dy: side * (EDGE_LABEL_HEIGHT / 2 + clearance) }
			: { dx: side * (half + clearance), dy: 0 })
		// el medio del hueco entre el tronco y la punta; si el hueco es chico, apoyado
		// justo arriba del tronco; y si no, otras alturas del tramo
		const runs = [total - ARROWHEAD - Math.max(0, last.length - ARROWHEAD) / 2,
			last.start + EDGE_LABEL_HEIGHT / 2 + LABEL_AIR + 1,
			...ALONG.map((fraction) => last.start + last.length * fraction)]
		return [
			...runs.flatMap((run) => [-1, 1].map((side) => ({ position: position(run), ...aside(side) }))),
			{ position: position(runs[0]), dx: 0, dy: 0 },
		]
	}
	const byLength = (a, b) => b.length - a.length
	const horizontals = legs.filter((leg) => leg.horizontal).sort(byLength)
	const verticals = legs.filter((leg) => !leg.horizontal).sort(byLength)
	const along = (leg, place) => ALONG.flatMap((fraction) => place(position(leg.start + leg.length * fraction)))
	// pegado a la linea; y si ahi no hay lugar, un renglon mas lejos (en un tramo
	// corto entre dos cajas vecinas, arriba esta el nombre y abajo otra flecha)
	const ring = (distance) => {
		const sides = route.relation.label ? [distance, -distance] : [-distance, distance]
		return horizontals.flatMap((leg) => along(leg, (at) => sides.map((dy) => ({ position: at, dx: 0, dy }))))
	}
	return [
		...ring(LABEL_LIFT),
		...verticals.flatMap((leg) => along(leg, (at) => [1, -1].map((side) => ({ position: at, dx: side * (half + SIDE_GAP), dy: 0 })))),
		// el segundo renglon: lo justo para no rozar el primero, contando el aire de los dos
		...ring(LABEL_LIFT + EDGE_LABEL_HEIGHT + 2 * LABEL_AIR + 1),
	]
}

/**
 * Que flecha lleva cada rotulo, y donde.
 *
 * Las de herencia y realizacion de un mismo padre forman un PEINE: comparten el
 * tramo que llega al padre, asi que el rotulo va una sola vez, en la flecha cuyo
 * ultimo tramo es el mas corto (esa parte la comparten todas, aunque alguna caja se
 * haya movido a mano). Las demas flechas llevan cada una el suyo.
 *
 * Primero se ubican los de los peines y despues el resto, y cada uno que se ubica
 * pasa a ser un obstaculo para los que siguen. De cada lista de candidatos gana el
 * primero que no pisa nada; si todos pisan algo, el que menos pisa.
 *
 * Con una excepcion: dos flechas de la misma clase entre las mismas dos cajas
 * (juliana conoce a satelital como su celular y como su empresa) van paralelas y
 * pegadas. Si la segunda no encuentra lugar libre, no lleva rotulo: el <conoce> de
 * la primera ya lo dice para las dos, y uno encima del otro no se leeria ninguno.
 *
 * @returns Map(route -> { text, position, dx, dy })
 */
const placeRelationLabels = (routes, rects, language) => {
	const combs = new Map()
	const loose = []
	for (const route of routes) {
		if (!relationLabelOf(route.relation.kind, language) || !legsOf(route).length) continue
		if (!route.structural) { loose.push(route); continue }
		const chosen = combs.get(combOf(route))
		if (!chosen || lastLegOf(route) < lastLegOf(chosen)) combs.set(combOf(route), route)
	}

	const obstacles = obstaclesOf(routes, rects)
	const placements = new Map()
	const bundles = new Set()   // clase + origen + destino de las que ya tienen rotulo
	for (const route of [...combs.values(), ...loose]) {
		const text = relationLabelOf(route.relation.kind, language)
		const legs = legsOf(route)
		const total = legs[legs.length - 1].start + legs[legs.length - 1].length
		const own = combOf(route) ?? route
		let best
		for (const candidate of candidatesOf(route, text)) {
			const point = pointAtRun(legs, ((candidate.position + 1) / 2) * total)
			const rect = labelRectOf(text, { x: point.x + candidate.dx, y: point.y + candidate.dy })
			const cost = obstacles.reduce((sum, obstacle) => sum + (overlaps(rect, obstacle.rect) ? obstacle.weight : 0), 0)
			if (!best || cost < best.cost) best = { ...candidate, rect, cost }
			if (!cost) break
		}
		const bundle = `${route.relation.kind}::${route.relation.from}::${route.relation.to}`
		if (best.cost && bundles.has(bundle)) continue
		bundles.add(bundle)
		placements.set(route, { text, position: best.position, dx: best.dx, dy: best.dy })
		obstacles.push({ rect: best.rect, weight: WEIGHT.text, owner: own })
	}
	return placements
}

/**
 * @param relationLabel  { text, position, dx, dy } de placeRelationLabels, o
 *                       undefined si esta flecha no lleva rotulo
 */
const edgeCells = (route, boxesByName, relationLabel) => {
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
	// <hereda>, <implementa>, <conoce>, <usa>, donde placeRelationLabels encontro lugar
	if (relationLabel) {
		const { text, position, dx, dy } = relationLabel
		cells.push(...edgeLabel(`${id}::kind`, id, text, position, -dy, dx))
	}
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
	const say = messagesFor(MESSAGES, options.language)
	const settings = {
		showAttributes: true,
		showOperations: true,
		showMutability: true,
		showFamilies: true,
		associations: 'both',
		header: [],
		previousGeometry: new Map(),
		...options,
		// sin nombre (o con `name: undefined`), el de por defecto en el idioma pedido
		name: options.name ?? say.defaultName,
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

	// Una caja que conserva su lugar del archivo anterior pero ahora mide MAS (un
	// archivo de cuando el ancho tenia tope en 420, o una fila que se alargo) puede
	// meterse en el pasillo de la columna de al lado, que es por donde pasan las
	// flechas. No se la mueve —ese lugar lo eligio alguien—: se avisa, y --relayout
	// vuelve a acomodar todo.
	//
	// Cuenta cualquier caja que antes quedaba a su derecha, a la altura que sea: el
	// pasillo corre de punta a punta, y se angosta aunque la vecina este mas abajo.
	const crowded = placedBoxes.filter((box) => {
		const before = settings.previousGeometry.get(box.name)
		if (!before?.width || box.width <= before.width) return false
		return placedBoxes.some((other) => other !== box
			&& other.x >= box.x + before.width
			&& other.x < box.x + box.width + CROWDED_GAP)
	}).map((box) => box.name)

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
	settings.report?.({ warnings, collisions, edges: routes.length, crowded })

	// El color de cada caja lo decide el nucleo, igual para draw.io y PlantUML.
	const colors = entityColorsOf(model, {
		palette: settings.palette ?? 'wollok',
		showFamilies: settings.showFamilies !== false,
	})

	const cells = []
	for (const box of boxes) cells.push(...boxCells(box, positions.get(box.name), colors))
	const relationLabels = placeRelationLabels(routes, rects, settings.language)
	for (const route of routes) cells.push(...edgeCells(route, boxesByName, relationLabels.get(route)))
	for (const { note, index, size, position } of notes) {
		cells.push(...noteCells(note, index, position, size))
	}

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		// Un comentario XML no puede tener "--" adentro: una ruta como
		// D:/mis--cosas/x.wlk dejaba un .drawio que no abre.
		...settings.header.map((line) => `<!-- ${String(line).replace(/--/g, '- -')} -->`),
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
