/*
 * La ayuda de wolloksd2drawio: la que se imprime con --help, o al llamarlo sin
 * argumentos. En los dos idiomas, con el mismo formato (sangrias y columnas).
 * Sale en el idioma que pidan los flags: ingles por defecto, castellano con
 * cualquiera de los --es...
 */

export const HELP = {
	en: `wolloksd2drawio — generates the class diagram in draw.io (diagrams.net) format
from Wollok code.

  node tools/wolloksd2drawio/cli.mjs src/ladrones.wlk -o docs/ladrones.drawio

Unlike PlantUML, the .drawio file keeps the positions: you open it in
draw.io (or in the VSCode extension) and drag everything around as you like.

When you regenerate it, the boxes that were already there STAY where you left
them: the ids are stable (the name of the entity) and the geometry of the
previous file is reused. New boxes are added at the bottom. With --relayout
everything is recomputed from scratch.

Options:
  -o, --output <file>        output .drawio file (default: stdout)
  -c, --config <file>        .uml.json sidecar (default: <output>.uml.json,
                             or else <source>.uml.json)
  -t, --title <text>         name of the diagram tab
      --relayout             ignore the positions from the previous file
      --without-inference    don't infer polymorphic families: neither the
                             interface they are missing, nor the shared color
      --associations <mode>  both (default) | arrow | attribute
      --no-attributes        don't show attributes
      --no-operations        don't show methods
      --no-mutability        don't show const/var
      --colourblind          color by polymorphic family, with colourblind-safe
                             tones
      --pastelcolors         same, with the draw.io pastel palette
                             (with neither of them: wollok light mode, and since
                             here all the entities are yours, all blue)
      --include-tests        include .wtest and .wpgm
  -q, --quiet                don't show warnings
      --enlang               messages in English (default)
      --eslang               messages in Spanish (also --esinclusivelang and
                             --esgenderlang)

The other possible output is PlantUML: see tools/wolloksd2puml.`,
	es: `wolloksd2drawio — genera el diagrama de clases en formato draw.io (diagrams.net)
a partir de codigo Wollok.

  node tools/wolloksd2drawio/cli.mjs src/ladrones.wlk -o docs/ladrones.drawio

A diferencia del PlantUML, el .drawio guarda las posiciones: se abre en
draw.io (o en la extension de VSCode) y se arrastra todo a gusto.

Al regenerarlo, las cajas que ya estaban CONSERVAN donde las dejaste: los ids
son estables (el nombre de la entidad) y se reusa la geometria del archivo
anterior. Las cajas nuevas se agregan abajo. Con --relayout se recalcula todo
desde cero.

Opciones:
  -o, --output <archivo>     archivo .drawio de salida (por defecto: stdout)
  -c, --config <archivo>     sidecar .uml.json (por defecto: <salida>.uml.json,
                             o si no <fuente>.uml.json)
  -t, --title <texto>        nombre de la pestaña del diagrama
      --relayout             ignorar las posiciones del archivo anterior
      --without-inference    no deducir familias polimorficas: ni la interfaz
                             que les falta, ni el color compartido
      --associations <modo>  both (por defecto) | arrow | attribute
      --no-attributes        no mostrar atributos
      --no-operations        no mostrar metodos
      --no-mutability        no mostrar const/var
      --colourblind          colorear por familia polimorfica, con tonos aptos
                             para daltonicos
      --pastelcolors         idem, con la paleta pastel de draw.io
                             (sin ninguno de los dos: wollok light mode, y como
                             aca todas las entidades son tuyas, todas azules)
      --include-tests        incluir .wtest y .wpgm
  -q, --quiet                no mostrar advertencias
      --enlang               mensajes en ingles (por defecto)
      --eslang               mensajes en castellano (tambien --esinclusivelang
                             y --esgenderlang)

La otra salida posible es PlantUML: ver tools/wolloksd2puml.`,
}
