import { Canvas, RouteStoryboard } from "tempo-sdk/canvas";

export default function TelasDoStudioCanvas() {
  return (
    <Canvas name="Telas do Studio" backgroundColor="#232323">
      <RouteStoryboard
        id="VisaoGeral"
        name="Visão geral"
        route="/app/instagram"
        layout={{ x: 0, y: 0, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="Criar"
        name="Criar arte ou carrossel"
        route="/app/instagram/new"
        layout={{ x: 1400, y: 0, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="MinhasCriacoes"
        name="Minhas criações"
        route="/app/instagram/library"
        layout={{ x: 2800, y: 0, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="Automacoes"
        name="Automações"
        route="/app/instagram/growth"
        layout={{ x: 4200, y: 0, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="Inspiracoes"
        name="Inspirações"
        route="/app/instagram/inspirations"
        layout={{ x: 0, y: 1020, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="Resultados"
        name="Meus resultados"
        route="/app/instagram/insights"
        layout={{ x: 1400, y: 1020, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="MinhaMarca"
        name="Minha marca"
        route="/app/settings/marca"
        layout={{ x: 2800, y: 1020, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="Conexoes"
        name="Conexões"
        route="/app/connections"
        layout={{ x: 4200, y: 1020, width: 1280, height: 900 }}
      />
      <RouteStoryboard
        id="VisaoGeralMobile"
        name="Visão geral · celular"
        route="/app/instagram"
        layout={{ x: 0, y: 2140, width: 390, height: 844 }}
      />
      <RouteStoryboard
        id="CriarMobile"
        name="Criar · celular"
        route="/app/instagram/new"
        layout={{ x: 510, y: 2140, width: 390, height: 844 }}
      />
      <RouteStoryboard
        id="MinhaMarcaMobile"
        name="Minha marca · celular"
        route="/app/settings/marca"
        layout={{ x: 1020, y: 2140, width: 390, height: 844 }}
      />
    </Canvas>
  );
}
