/*
 * Colores.
 *
 * La regla del enunciado es "los objetos polimórficos entre sí van del mismo
 * color". La familia polimórfica ya viene calculada en el modelo (por herencia
 * o por entender los mismos mensajes); acá solo se le asigna un color a cada
 * familia, en orden de aparición, para que el diagrama sea reproducible.
 *
 * Los tipos de la biblioteca tienen color fijo, aparte de las familias.
 *
 * Y lo tienen APAGADO a propósito. El color saturado es un recurso escaso —con
 * visión dicromática hay lugar para siete tonos, no para veinte— y en este
 * diagrama lo que de verdad necesita color son las FAMILIAS polimórficas, que es
 * lo que uno quiere ver de un vistazo. Los tipos ya se distinguen por otras dos
 * vías más fuertes: la FORMA (el booleano es un círculo, el número una elipse
 * chata, la colección un círculo grande) y el VALOR escrito adentro.
 *
 * Conviene ser honesto con lo que el color hace acá: nueve rellenos claros no se
 * separan. Medidos con daltonismo simulado, el peor par de esta tabla queda en
 * ΔE 2.4 sobre un objetivo de 8 (la tabla vieja estaba en 1.4, con un verde puro
 * y un cian que son el par que más se confunde). O sea que es una ayuda, no una
 * codificación: el que lee un número sabe que es un número porque dice `80`.
 */

// La paleta vive en el núcleo: la comparte con el diagrama de clases, y el
// reparto de colores también, para que una misma familia salga del mismo color
// en los dos diagramas.
import { styleFor, isFromLibrary } from '../wollok-uml/palette.mjs'

const FIXED_ACCESSIBLE = {
	'wollok.lang.Number': { fill: '#BFD9E8', stroke: '#40708C' },
	'wollok.lang.Boolean': { fill: '#C9E3C4', stroke: '#4A7A44' },
	'wollok.lang.String': { fill: '#F2E6BF', stroke: '#8A7534' },
	// tres tipos que aparecen poco pero conviene distinguir de un vistazo
	'wollok.lang.Date': { fill: '#A9C7CC', stroke: '#3E6A72' },
	'wollok.lang.Range': { fill: '#DCC9D6', stroke: '#7A5C70' },
	'wollok.lang.Pair': { fill: '#DCDCDC', stroke: '#666666' },
}

const FIXED_PASTEL = {
	'wollok.lang.Number': { fill: '#00CCFF', stroke: '#0066CC' },
	'wollok.lang.Boolean': { fill: '#00CC00', stroke: '#006600' },
	'wollok.lang.String': { fill: '#FFF2CC', stroke: '#D6B656' },
	'wollok.lang.Date': { fill: '#B0E3E6', stroke: '#0E8088' },
	'wollok.lang.Range': { fill: '#E6D0DE', stroke: '#996185' },
	'wollok.lang.Pair': { fill: '#EEEEEE', stroke: '#666666' },
}

const BY_KIND_ACCESSIBLE = {
	collection: { fill: '#E8CDAE', stroke: '#8A6A3C' },
	null: { fill: '#FFFFFF', stroke: '#999999' },
	literal: { fill: '#F2F2F2', stroke: '#666666' },
}

const BY_KIND_PASTEL = {
	collection: { fill: '#FFCC99', stroke: '#D79B00' },
	null: { fill: '#FFFFFF', stroke: '#999999' },
	literal: { fill: '#F5F5F5', stroke: '#666666' },
}

const tablesFor = (pastel) => ({
	FIXED: pastel ? FIXED_PASTEL : FIXED_ACCESSIBLE,
	BY_KIND: pastel ? BY_KIND_PASTEL : BY_KIND_ACCESSIBLE,
})

const isColoredByFamily = (object) => object.kind === 'instance' || object.kind === 'wko'

/**
 * El color de cada familia.
 *
 * Lo decide el modelo ESTÁTICO, no este diagrama: `colorIndex` viene de
 * `colorIndexOf` del núcleo, que es exactamente lo mismo que consulta el
 * diagrama de clases. Así una familia sale del mismo color en los dos, y se
 * pueden mirar juntos.
 *
 * Se resuelve por FAMILIA, no objeto por objeto: si los miembros de una familia
 * cayeran en familias estáticas distintas, pintarlos distinto partiría en dos
 * algo que este diagrama muestra junto. En ese caso —y en el de los objetos sin
 * equivalente estático, como los anónimos— la familia entera se lleva un color
 * aparte, que se toma después de todos los que usó el diagrama de clases para
 * no pisarle ninguno.
 */
const familyColorsOf = (model, colorIndex, { palette }) => {
	const { FIXED } = tablesFor(palette === 'pastel')
	const groups = new Map()
	for (const object of model.objects) {
		if (FIXED[object.module] || !isColoredByFamily(object)) continue
		groups.set(object.family, [...(groups.get(object.family) ?? []), object])
	}

	const styles = new Map()
	let extra = 0
	for (const [family, members] of groups) {
		const indexes = new Set(members.map((object) => colorIndex.get(object.className)))
		const [only] = [...indexes]
		styles.set(family, indexes.size === 1 && only !== undefined
			? styleFor({ index: only }, { palette })
			: styleFor({ index: colorIndex.size + extra++ }, { palette }))
	}
	return styles
}

/**
 * @param colorIndex       Map(nombre de clase o WKO -> indice de color), de colorIndexOf
 * @param options.palette  uno de PALETTE_NAMES
 * @returns Map(id del objeto -> { fill, stroke })
 */
export const colorsFor = (model, colorIndex = new Map(), { palette = 'wollok' } = {}) => {
	// Wollok light mode no pregunta por familias ni por tipos: una sola pregunta,
	// de donde viene cada objeto. Un literal `200` es un wollok.lang.Number, o sea
	// biblioteca; una instancia de tu clase, no.
	if (palette === 'wollok') {
		return new Map(model.objects.map((object) => [
			object.id,
			styleFor({ library: isFromLibrary(object.module) || object.kind === 'null' }, { palette }),
		]))
	}

	const { FIXED, BY_KIND } = tablesFor(palette === 'pastel')
	const styles = familyColorsOf(model, colorIndex, { palette })
	const colors = new Map()

	for (const object of model.objects) {
		// Los tipos de la biblioteca tienen color propio y no entran en ninguna
		// familia: un Date es un Date, aunque el ejemplo lo use de manera
		// intercambiable con otra cosa.
		if (FIXED[object.module]) colors.set(object.id, FIXED[object.module])
		else if (!isColoredByFamily(object)) colors.set(object.id, BY_KIND[object.kind] ?? BY_KIND.literal)
		else colors.set(object.id, styles.get(object.family))
	}
	return colors
}

/** Cuántas familias distintas hay, para poder avisar si se acabó la paleta. */
export const familyCountOf = (model) =>
	new Set(model.objects.filter((object) => isColoredByFamily(object) && !FIXED_ACCESSIBLE[object.module])
		.map((object) => object.family)).size
