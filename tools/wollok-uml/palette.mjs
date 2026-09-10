/*
 * La paleta de colores de los diagramas.
 *
 * Vive en el nucleo porque la usan los DOS: el de clases y el de objetos. Y no
 * es decoracion — es la forma de que los dos digan lo mismo. La regla es una
 * sola:
 *
 *   MISMO COLOR = MISMA FAMILIA POLIMORFICA.
 *
 * Quien no es polimorfico con nadie tambien recibe su propio color, distinto al
 * de todos los demas. Antes todos los WKO solitarios compartian el naranja, y
 * eso decia justo lo contrario de lo que el color tiene que decir: los ponia
 * juntos sin tener nada que ver entre si.
 *
 * El indice lo reparte families.mjs (colorIndexOf): primero los grupos y
 * despues los individuales, para que los grupos —que es lo que importa ver de un
 * vistazo— se lleven los colores mas distinguibles.
 */

/*
 * Los primeros son los de la paleta de draw.io: claros, con buen contraste
 * contra texto negro, y con su borde mas oscuro del mismo tono.
 */
const HAND_PICKED = [
	{ fill: '#DAE8FC', stroke: '#6C8EBF' },   // azul
	{ fill: '#CC99FF', stroke: '#9673A6' },   // violeta
	{ fill: '#CCFFCC', stroke: '#82B366' },   // verde claro
	{ fill: '#FFFF99', stroke: '#D6B656' },   // amarillo
	{ fill: '#F8CECC', stroke: '#B85450' },   // rosa
	{ fill: '#B1DDF0', stroke: '#10739E' },   // celeste
	{ fill: '#FFE6CC', stroke: '#D79B00' },   // durazno
	{ fill: '#E1D5E7', stroke: '#9673A6' },   // lila
	{ fill: '#D0CEE2', stroke: '#56517E' },   // gris violaceo
	{ fill: '#FAD9D5', stroke: '#AE4132' },   // salmon
	{ fill: '#D5E8D4', stroke: '#82B366' },   // verde grisaceo
	{ fill: '#FFF2CC', stroke: '#D6B656' },   // crema
]

const hsl = (hue, saturation, lightness) => {
	const a = saturation * Math.min(lightness, 1 - lightness)
	const channel = (n) => {
		const k = (n + hue / 30) % 12
		const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
		return Math.round(255 * value).toString(16).padStart(2, '0')
	}
	return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase()
}

/*
 * Pasados los elegidos a mano se generan solos, rotando el tono con el angulo
 * aureo (137.5 grados) para que dos consecutivos nunca queden parecidos. Salen
 * igual de claros que los de arriba, asi el texto negro se sigue leyendo.
 */
const generated = (index) => {
	const hue = (index * 137.508) % 360
	return { fill: hsl(hue, 0.55, 0.88), stroke: hsl(hue, 0.45, 0.45) }
}

/** El color numero n. Es una funcion total: nunca se queda sin colores. */
export const colorAt = (index) =>
	index < HAND_PICKED.length ? HAND_PICKED[index] : generated(index - HAND_PICKED.length)
