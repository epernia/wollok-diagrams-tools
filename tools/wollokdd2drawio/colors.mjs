/*
 * Colores.
 *
 * La regla del enunciado es "los objetos polimórficos entre sí van del mismo
 * color". La familia polimórfica ya viene calculada en el modelo (por herencia
 * o por entender los mismos mensajes); acá solo se le asigna un color a cada
 * familia, en orden de aparición, para que el diagrama sea reproducible.
 *
 * Los tipos básicos tienen color fijo, como en los diagramas hechos a mano:
 * números celestes, booleanos verdes, colecciones naranja claro, WKO naranja.
 */

// La paleta vive en el núcleo: la comparte con el diagrama de clases, y el
// reparto de colores también, para que una misma familia salga del mismo color
// en los dos diagramas.
import { colorAt } from '../wollok-uml/palette.mjs'

const FIXED = {
	'wollok.lang.Number': { fill: '#00CCFF', stroke: '#0066CC' },
	'wollok.lang.Boolean': { fill: '#00CC00', stroke: '#006600' },
	'wollok.lang.String': { fill: '#FFF2CC', stroke: '#D6B656' },
	// tres tipos que aparecen poco pero conviene distinguir de un vistazo
	'wollok.lang.Date': { fill: '#B0E3E6', stroke: '#0E8088' },
	'wollok.lang.Range': { fill: '#E6D0DE', stroke: '#996185' },
	'wollok.lang.Pair': { fill: '#EEEEEE', stroke: '#666666' },
}

const BY_KIND = {
	collection: { fill: '#FFCC99', stroke: '#D79B00' },
	null: { fill: '#FFFFFF', stroke: '#999999' },
	literal: { fill: '#F5F5F5', stroke: '#666666' },
}

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
const familyColorsOf = (model, colorIndex) => {
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
			? colorAt(only)
			: colorAt(colorIndex.size + extra++))
	}
	return styles
}

/**
 * @param colorIndex  Map(nombre de clase o WKO -> indice de color), de colorIndexOf
 * @returns Map(id del objeto -> { fill, stroke })
 */
export const colorsFor = (model, colorIndex = new Map()) => {
	const styles = familyColorsOf(model, colorIndex)
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
	new Set(model.objects.filter((object) => isColoredByFamily(object) && !FIXED[object.module])
		.map((object) => object.family)).size
