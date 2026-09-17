/*
 * La ayuda de wolloksd2puml: la que se imprime con --help, o al llamarlo sin
 * argumentos. En los dos idiomas, con el mismo formato (sangrias y columnas).
 * Sale en el idioma que pidan los flags: ingles por defecto, castellano con
 * cualquiera de los --es...
 */

export const HELP = {
	en: `wolloksd2puml — generates the class diagram in PlantUML from Wollok code.

  node tools/wolloksd2puml/cli.mjs src/ladrones.wlk -o docs/ladrones.puml
  node tools/wolloksd2puml/cli.mjs src -o docs/all.puml --title "My domain"

Options:
  -o, --output <file>        output .puml file (default: stdout)
  -c, --config <file>        .uml.json sidecar (default: <output>.uml.json,
                             or else <source>.uml.json)
  -t, --title <text>         title of the diagram
      --associations <mode>  both (default) | arrow | attribute
      --no-attributes        don't show attributes
      --no-operations        don't show methods
      --no-mutability        don't show const/var
      --without-inference    don't infer the interface that each polymorphic
                             family is missing, nor the shared color
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

The other possible output is draw.io: see tools/wolloksd2drawio.`,
	es: `wolloksd2puml — genera el diagrama de clases en PlantUML a partir de codigo Wollok.

  node tools/wolloksd2puml/cli.mjs src/ladrones.wlk -o docs/ladrones.puml
  node tools/wolloksd2puml/cli.mjs src -o docs/todo.puml --title "Mi dominio"

Opciones:
  -o, --output <archivo>     archivo .puml de salida (por defecto: stdout)
  -c, --config <archivo>     sidecar .uml.json (por defecto: <salida>.uml.json,
                             o si no <fuente>.uml.json)
  -t, --title <texto>        titulo del diagrama
      --associations <modo>  both (por defecto) | arrow | attribute
      --no-attributes        no mostrar atributos
      --no-operations        no mostrar metodos
      --no-mutability        no mostrar const/var
      --without-inference    no deducir la interfaz que le falta a cada
                             familia polimorfica, ni el color compartido
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

La otra salida posible es draw.io: ver tools/wolloksd2drawio.`,
}
