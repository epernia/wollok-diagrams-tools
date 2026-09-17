/*
 * La ayuda de wollokdd2drawio (--help, o llamarlo sin argumentos), en los dos
 * idiomas. Sale en el idioma que pidan los flags: ingles por defecto, castellano
 * con cualquiera de los --es...
 *
 * El texto en castellano es el que antes se sacaba del comentario de cabecera de
 * cli.mjs.
 */

export const HELP = {
	en: `wollokdd2drawio — generates an OBJECT DIAGRAM in draw.io format from a
Wollok model (.wlk) and a runnable example (.wrepl).

  node tools/wollokdd2drawio/cli.mjs exercise1
  node tools/wollokdd2drawio/cli.mjs model.wlk example.wrepl -o diagram.drawio

With a SINGLE argument it is taken as a base name: it looks for <base>.wlk and
<base>.wrepl and writes <base>_dynamic.drawio. If the argument is a folder,
it looks for the .wlk and the .wrepl inside it.

With two or more, the .wrepl is detected by its extension; order doesn't matter.

The .wrepl is OPTIONAL: without an example to run, the diagram shows the
environment as it is right after loading the model, that is, only its WKOs.

Unlike the class diagram, this one can't be obtained by reading the code:
it has to be RUN. The .wrepl is run line by line with the same interpreter
the Wollok REPL uses, and then the graph of objects left alive in the
environment is walked.

What it draws:
  - the objects as ellipses (with --showenv, inside an "Environment" rectangle,
    "Ambiente" with the Spanish modes);
  - the var and const of each object, as outgoing arrows with their name, in
    black, with a padlock 🔒 attached to the name if they are const;
  - the global references of the .wrepl, as text outside the environment with an
    arrow that comes in and points at the object;
  - the WKOs as an oval with their own name inside (with --wkoshowref, also
    their constant global reference);
  - the elements of a List numbered 0, 1, 2...;
  - one color per polymorphic family.

With --genseq it generates the SEQUENCE, not a single snapshot: a file with
one page per line of the .wrepl, and below the environment the line that was
run. Lines that don't change the diagram don't open a new page: they are
added below the drawing they didn't modify.

Options:
  -o, --output <file>      output .drawio (default: <base>_dynamic.drawio,
                           or <base>_dynamic_seq.drawio with --genseq)
      --genseq             generate the step-by-step sequence
      --wkoshowref         also draw the global reference of each WKO,
                           even though its name is already inside the oval
      --showenv            draw the Environment rectangle
      --hidepadlock        don't put the padlock 🔒 on const references
      --refcolors          color the references: const and object names in
                           red, var in green (by default all of them in black)
      --colourblind        color by polymorphic family, with colourblind-safe
                           tones
      --pastelcolors       same, with the draw.io pastel palette
                           (with neither of them: wollok light mode, green for
                           what Wollok provides and blue for what you wrote)
  -t, --title <text>       name of the diagram tab
  Language and article of the instances (if several are given, the last wins):
  (the language also applies to the messages and to this help)
      --enlang             DEFAULT. Texts in English (Environment,
                           Construction, Object diagram) and in the instances
                           only the class name: Persona
      --enarticlelang      same, with "a"/"an" in front: aPersona,
                           anEmpresaConEmpleados
      --eslang             texts in Spanish (Ambiente, Construccion) and
                           only the class name: Persona
      --esinclusivelang    same, with gender-neutral "une": unePersona
      --esgenderlang       same, with "un"/"una" by the gender inferred from
                           the FIRST word of the name: unaEmpresaConEmpleados
      --feminine <A,B>     classes that take "una"; only with --esgenderlang
      --masculine <A,B>    the same, the other way around
      --relayout           ignore the positions from the previous file
  -q, --quiet              don't show warnings`,
	es: `wollokdd2drawio — genera un DIAGRAMA DE OBJETOS en formato draw.io a partir de un
modelo Wollok (.wlk) y un ejemplo ejecutable (.wrepl).

  node tools/wollokdd2drawio/cli.mjs ejercicio1
  node tools/wollokdd2drawio/cli.mjs modelo.wlk ejemplo.wrepl -o diagrama.drawio

Con UN solo parámetro se lo toma como nombre base: busca <base>.wlk y
<base>.wrepl y escribe <base>_dynamic.drawio. Si el parámetro es una carpeta,
busca adentro el .wlk y el .wrepl.

Con dos o más, el .wrepl se reconoce por su extensión y el orden no importa.

El .wrepl es OPCIONAL: sin ejemplo que ejecutar, el diagrama muestra el ambiente
tal como queda al cargar el modelo, o sea solamente sus WKO.

A diferencia del diagrama de clases, este no se puede sacar leyendo el código:
hay que EJECUTARLO. El .wrepl se corre línea por línea con el mismo intérprete
que usa el REPL de Wollok, y después se camina el grafo de objetos que quedó
vivo en el ambiente.

Qué dibuja:
  - los objetos como elipses (con --showenv, adentro de un rectángulo
    "Environment", "Ambiente" con los modos en castellano);
  - las var y const de cada objeto, como flechas salientes con su nombre, en
    negro, con un candado 🔒 pegado al nombre si son const;
  - las referencias globales del .wrepl, como texto fuera del ambiente con una
    flecha que entra y pincha al objeto;
  - los WKO como un óvalo con su propio nombre adentro (con --wkoshowref,
    también su referencia global constante);
  - los elementos de una List numerados 0, 1, 2...;
  - un color por familia polimórfica.

Con --genseq no genera una sola foto sino la SECUENCIA: un archivo con una
página por cada línea del .wrepl, y al pie del ambiente la línea que se
ejecutó. Las líneas que no cambian el diagrama no abren página nueva: se
suman al pie del dibujo que no modificaron.

Opciones:
  -o, --output <archivo>   .drawio de salida (por defecto: <base>_dynamic.drawio,
                           o <base>_dynamic_seq.drawio con --genseq)
      --genseq             generar la secuencia paso a paso
      --wkoshowref         dibujar tambien la referencia global de cada WKO,
                           aunque su nombre ya este adentro del ovalo
      --showenv            dibujar el rectangulo del Ambiente
      --hidepadlock        no poner el candado 🔒 en las referencias const
      --refcolors          pintar las referencias: const y nombres de object en
                           rojo, var en verde (por defecto todas en negro)
      --colourblind        colorear por familia polimorfica, con tonos aptos
                           para daltonicos
      --pastelcolors       idem, con la paleta pastel de draw.io
                           (sin ninguno de los dos: wollok light mode, verde lo
                           que trae Wollok y azul lo que escribiste vos)
  -t, --title <texto>      nombre de la pestaña del diagrama
  El idioma y el articulo de las instancias (si se pasan varios, vale el ultimo):
  (el idioma vale tambien para los mensajes y para esta ayuda)
      --enlang             POR DEFECTO. Textos en ingles (Environment,
                           Construction, Object diagram) y en las instancias
                           solo el nombre de la clase: Persona
      --enarticlelang      idem, con "a"/"an" delante: aPersona,
                           anEmpresaConEmpleados
      --eslang             textos en castellano (Ambiente, Construccion) y
                           solo el nombre de la clase: Persona
      --esinclusivelang    idem, con "une" sin marcar genero: unePersona
      --esgenderlang       idem, con "un"/"una" segun el genero inferido de la
                           PRIMERA palabra del nombre: unaEmpresaConEmpleados
      --feminine <A,B>     clases que llevan "una"; solo cuenta con --esgenderlang
      --masculine <A,B>    idem al reves
      --relayout           ignorar las posiciones del archivo anterior
  -q, --quiet              no mostrar advertencias`,
}
