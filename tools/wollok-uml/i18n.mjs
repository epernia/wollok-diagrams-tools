/*
 * El idioma en que las herramientas le hablan al usuario: los avisos, los
 * errores, el resumen de lo que generaron, la ayuda y los textos que escriben
 * por su cuenta dentro de los archivos (la cabecera de "generado por").
 *
 * Por defecto, ingles. Con cualquiera de los flags --es..., castellano. Son los
 * mismos cinco flags del diagrama de objetos, que ahi deciden ademas el articulo
 * de las instancias; en las herramientas que no dibujan instancias, --enlang y
 * --enarticlelang dan lo mismo, y los tres --es... tambien.
 *
 * Lo que NO se traduce: lo que viene de tu codigo (nombres de clases, atributos,
 * lineas del .wrepl), los ids internos de los .drawio, que son el ancla de las
 * posiciones guardadas, y los errores que no son de estas herramientas (los del
 * interprete de Wollok o los de Node, como un archivo que no existe).
 *
 * Cada modulo que habla con el usuario tiene su propio catalogo `MESSAGES`, con
 * las mismas claves en `en` y en `es`, y toma el que corresponde con
 * `messagesFor(MESSAGES, language)`. Los textos que llevan datos son funciones.
 */

/** Los cinco modos; el prefijo dice el idioma, y lo que sigue, el articulo. */
export const LANGUAGES = ['en', 'enArticle', 'es', 'esInclusive', 'esGendered']

/** El modo cuando no se pasa ningun flag de idioma. */
export const DEFAULT_LANGUAGE = 'en'

/** Cada flag y su modo. Si se pasan varios, vale el ultimo. */
export const LANGUAGE_FLAGS = {
	'--enlang': 'en',
	'--enarticlelang': 'enArticle',
	'--eslang': 'es',
	'--esinclusivelang': 'esInclusive',
	'--esgenderlang': 'esGendered',
}

/** Si los textos de la herramienta van en ingles. Sin modo, vale el de por defecto. */
export const isEnglish = (language) => ['en', 'enArticle'].includes(language ?? DEFAULT_LANGUAGE)

/** El idioma de un modo, sin el articulo: 'en' o 'es'. */
export const localeOf = (language) => isEnglish(language) ? 'en' : 'es'

/** El catalogo de un modulo en el idioma de un modo. */
export const messagesFor = (catalog, language) => catalog[localeOf(language)]

/**
 * Si un argumento es uno de los flags de idioma. Con hasOwn y no leyendo la clave:
 * un archivo que se llame `constructor` o `toString` no es un flag.
 */
export const isLanguageFlag = (argument) => Object.hasOwn(LANGUAGE_FLAGS, argument)
