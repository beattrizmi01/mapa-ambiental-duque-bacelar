import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  LayersControl,
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import duqueBacelarLimiteUrl from "./data/duque-bacelar-limite.geojson?url";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

const STORAGE_KEY = "mapa-ambiental-duque-bacelar:areas";
const FALLBACK_CENTER = [-4.1533881, -42.9459142];
const BOUNDARY_STYLE = { color: "#3a6ae6", weight: 2, fillColor: "transparent", fillOpacity: 0 };
const STREET_TILES = {
  url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, style by Humanitarian OpenStreetMap Team hosted by OpenStreetMap France',
};
const SATELLITE_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri, Earthstar Geographics",
};
const LABEL_TILES = {
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "Labels &copy; Esri, Garmin, HERE, OpenStreetMap contributors, and the GIS user community",
};
const CATEGORIES = [
  "Vegetação nativa",
  "Fauna",
  "Recursos hídricos",
  "Áreas de preservação",
  "Áreas degradadas",
  "Impactos ambientais",
  "Registros científicos",
  "Educação ambiental",
  "Outro",
];
const DEFAULT_AREAS = [
  areaSeed("Reserva do Buritizal", "Vegetação nativa", "preservado", "Cobertura vegetal estável e vigilância comunitária ativa.", "Área com boa regeneração natural e trilhas monitoradas por agentes locais.", createAreaPolygon(-4.122, -42.991)),
  areaSeed("Margem do Riacho Bacelar", "Recursos hídricos", "atencao", "Sinais de assoreamento e descarte irregular em pontos isolados.", "Trecho com pressão moderada, exigindo vistoria mais frequente e limpeza preventiva.", createAreaPolygon(-4.145, -42.951)),
  areaSeed("Zona de Queimada Recente", "Áreas degradadas", "critico", "Solo exposto, focos de calor recorrentes e risco alto de erosão.", "Ocorrência severa registrada por moradores, com necessidade de resposta rápida.", createAreaPolygon(-4.101, -42.903)),
];

export default function App() {
  const [openCard, setOpenCard] = useState(null);
  const [areas, setAreas] = useState(() => loadAreas());
  const [boundaryData, setBoundaryData] = useState(null);
  const [dataMode, setDataMode] = useState(hasSupabaseConfig() ? "supabase" : "local");
  const [dataStatus, setDataStatus] = useState(hasSupabaseConfig() ? "Conectando ao Supabase..." : "Usando armazenamento local do navegador.");
  const [hoveredAreaId, setHoveredAreaId] = useState(null);
  const [activeAreaId, setActiveAreaId] = useState(null);
  const [occurrenceLocation, setOccurrenceLocation] = useState(null);
  const [areaPreview, setAreaPreview] = useState(null);
  const [occurrencePreview, setOccurrencePreview] = useState(null);
  const [isDrawingArea, setIsDrawingArea] = useState(false);
  const [draftPolygonCoords, setDraftPolygonCoords] = useState([]);
  const [areaForm, setAreaForm] = useState(emptyAreaForm());
  const [occurrenceForm, setOccurrenceForm] = useState(emptyOccurrenceForm());
  const [isSavingArea, setIsSavingArea] = useState(false);
  const [isSavingOccurrence, setIsSavingOccurrence] = useState(false);
  const [areaSuccessMessage, setAreaSuccessMessage] = useState("");
  const [occurrenceSuccessMessage, setOccurrenceSuccessMessage] = useState("");
  const draftPolygonReady = draftPolygonCoords.length >= 3;
  const draftPolygonCenter = useMemo(
    () => (draftPolygonCoords.length ? computeCentroid(draftPolygonCoords) : null),
    [draftPolygonCoords],
  );

  useEffect(() => {
    fetch(duqueBacelarLimiteUrl)
      .then((response) => response.json())
      .then((data) => setBoundaryData(data))
      .catch(() => setBoundaryData(null));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadFromSupabase() {
      if (!hasSupabaseConfig()) return;
      const { data, error } = await supabase.from("areas").select("*").order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        console.error(error);
        setDataMode("local");
        setDataStatus("Não foi possível carregar do Supabase. Exibindo dados locais.");
        return;
      }
      const mapped = (data ?? []).map(mapSupabaseAreaToApp).filter(Boolean);
      setAreas(mapped);
      setDataMode("supabase");
      setDataStatus(mapped.length ? `Exibindo ${mapped.length} registro(s) do Supabase.` : "Supabase conectado, mas nenhuma área foi encontrada ainda.");
    }
    loadFromSupabase();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(areas));
  }, [areas]);

  useEffect(() => {
    if (!occurrenceForm.areaId && areas[0]) {
      setOccurrenceForm((current) => ({ ...current, areaId: areas[0].id }));
    }
  }, [areas, occurrenceForm.areaId]);

  function resetAreaDraft() {
    setAreaForm(emptyAreaForm());
    setAreaPreview(null);
    setDraftPolygonCoords([]);
    setIsDrawingArea(false);
    setAreaSuccessMessage("");
  }

  function resetOccurrenceDraft() {
    setOccurrenceForm(emptyOccurrenceForm(areas[0]?.id ?? ""));
    setOccurrencePreview(null);
    setOccurrenceLocation(null);
    setOccurrenceSuccessMessage("");
  }

  function startAreaDrawing() {
    setOpenCard("area");
    setActiveAreaId(null);
    setHoveredAreaId(null);
    setDraftPolygonCoords([]);
    setAreaForm((current) => ({ ...current, polygonCoords: [] }));
    setIsDrawingArea(true);
    setDataStatus("Modo de demarcação ativo. Clique no mapa para adicionar os vértices da nova área.");
  }

  function concludeAreaDrawing() {
    if (draftPolygonCoords.length < 3) {
      setDataStatus("Adicione pelo menos 3 vértices para concluir a área.");
      return;
    }

    setAreaForm((current) => ({ ...current, polygonCoords: draftPolygonCoords }));
    setIsDrawingArea(false);
    setDataStatus(`Área demarcada com ${draftPolygonCoords.length} vértices. Agora preencha os dados e salve.`);
  }

  function clearAreaDrawing() {
    setDraftPolygonCoords([]);
    setAreaForm((current) => ({ ...current, polygonCoords: [] }));
    setDataStatus("Demarcação limpa. Clique no mapa para começar novamente.");
  }

  async function handleAreaSubmit(event) {
    event.preventDefault();
    setAreaSuccessMessage("");

    const normalizedName = normalizeAreaName(areaForm.name);
    const duplicateArea = areas.find((area) => normalizeAreaName(area.name) === normalizedName);
    if (duplicateArea) {
      setDataStatus("Já existe uma área cadastrada com esse nome. Escolha outro nome para continuar.");
      setOpenCard("area");
      return;
    }

    const polygonCoords = areaForm.polygonCoords.length ? areaForm.polygonCoords : draftPolygonCoords;
    if (polygonCoords.length < 3) {
      setDataStatus("Desenhe a área no mapa e conclua a demarcação antes de salvar.");
      setOpenCard("area");
      return;
    }

    setIsSavingArea(true);

    const [latitude, longitude] = computeCentroid(polygonCoords);

    const draft = {
      id: createId(),
      name: areaForm.name.trim(),
      category: areaForm.category.trim(),
      status: areaForm.status,
      impact: areaForm.impact.trim(),
      description: areaForm.description.trim(),
      polygonCoords,
      latitude,
      longitude,
      image: areaPreview ?? createPlaceholderImage(areaForm.name.trim(), statusToColor(areaForm.status)),
    };
    if (hasSupabaseConfig()) {
      const { data, error } = await supabase.from("areas").insert({
        name: draft.name,
        category: draft.category,
        status: draft.status,
        impact: draft.impact,
        description: draft.description,
        latitude: draft.latitude,
        longitude: draft.longitude,
        image_url: draft.image,
        polygon_coords: draft.polygonCoords,
      }).select().single();
      if (error) {
        console.error(error);
        setDataMode("local");
        setDataStatus("Não foi possível salvar o polígono no Supabase. A área foi salva localmente.");
        setAreas((current) => [draft, ...current]);
        setActiveAreaId(draft.id);
        setAreaSuccessMessage("Área salva localmente com sucesso.");
      } else {
        const mapped = mapSupabaseAreaToApp(data) ?? draft;
        setDataMode("supabase");
        setDataStatus("Nova área salva e sincronizada com o Supabase.");
        setAreas((current) => [mapped, ...current]);
        setActiveAreaId(mapped.id);
        setAreaSuccessMessage("Área cadastrada com sucesso.");
      }
    } else {
      setAreas((current) => [draft, ...current]);
      setDataStatus("Nova área salva localmente no navegador.");
      setActiveAreaId(draft.id);
      setAreaSuccessMessage("Área cadastrada com sucesso.");
    }
    setIsSavingArea(false);
    resetAreaDraft();
    setOpenCard(null);
  }

  async function handleOccurrenceSubmit(event) {
    event.preventDefault();
    setOccurrenceSuccessMessage("");

    const targetArea = areas.find((area) => area.id === occurrenceForm.areaId);
    if (!targetArea) {
      setDataStatus("Selecione uma área válida para registrar a ocorrência.");
      return;
    }

    setIsSavingOccurrence(true);

    const baseDescription = occurrenceForm.description.trim();
    const locationSuffix =
      occurrenceLocation && occurrenceForm.areaId
        ? `\n\nPonto registrado no mapa: ${occurrenceLocation.latitude.toFixed(6)}, ${occurrenceLocation.longitude.toFixed(6)}`
        : "";
    const shouldUpdateStatus =
      occurrenceForm.updateStatus &&
      occurrenceForm.nextStatus &&
      occurrenceForm.nextStatus !== targetArea.status;
    const patch = {
      impact: occurrenceForm.impact.trim(),
      description: `${baseDescription}${locationSuffix}`,
      status: shouldUpdateStatus ? occurrenceForm.nextStatus : targetArea.status,
      previousStatus: shouldUpdateStatus ? targetArea.status : null,
      statusUpdated: shouldUpdateStatus,
      lastStatusReviewAt: new Date().toISOString(),
    };
    if (hasSupabaseConfig()) {
      const payload = {
        impact: patch.impact,
        description: patch.description,
        ...(shouldUpdateStatus ? { status: patch.status } : {}),
        ...(occurrencePreview ? { image_url: occurrencePreview } : {}),
      };
      const { data, error } = await supabase.from("areas").update(payload).eq("id", occurrenceForm.areaId).select().single();
      if (error) {
        console.error(error);
        setDataMode("local");
        setDataStatus("Não foi possível atualizar no Supabase. A ocorrência foi aplicada localmente.");
        setAreas((current) =>
          current.map((area) =>
            area.id === occurrenceForm.areaId
              ? { ...area, ...patch, image: occurrencePreview ?? area.image }
              : area,
          ),
        );
        setOccurrenceSuccessMessage("Ocorrência registrada localmente com sucesso.");
      } else {
        const mapped = mapSupabaseAreaToApp(data);
        setDataMode("supabase");
        setDataStatus(
          shouldUpdateStatus
            ? "Ocorrência sincronizada e status da área atualizado."
            : "Ocorrência sincronizada sem alterar o status da área.",
        );
        setAreas((current) =>
          current.map((area) =>
            area.id === occurrenceForm.areaId
              ? {
                  ...(mapped ?? area),
                  previousStatus: patch.previousStatus,
                  statusUpdated: patch.statusUpdated,
                  lastStatusReviewAt: patch.lastStatusReviewAt,
                }
              : area,
          ),
        );
        setOccurrenceSuccessMessage("Ocorrência registrada com sucesso.");
      }
    } else {
      setAreas((current) =>
        current.map((area) =>
          area.id === occurrenceForm.areaId
            ? { ...area, ...patch, image: occurrencePreview ?? area.image }
            : area,
        ),
      );
      setDataStatus(
        shouldUpdateStatus
          ? "Ocorrência salva localmente e status da área atualizado."
          : "Ocorrência salva localmente sem alterar o status da área.",
      );
      setOccurrenceSuccessMessage("Ocorrência registrada com sucesso.");
    }
    setIsSavingOccurrence(false);
    setActiveAreaId(occurrenceForm.areaId);
    resetOccurrenceDraft();
    setOpenCard(null);
  }

  return (
    <div className="app-shell">
      <Sidebar
        openCard={openCard}
        onToggle={(cardName) => setOpenCard((current) => (current === cardName ? null : cardName))}
        dataMode={dataMode}
        dataStatus={dataStatus}
        areas={areas}
        areaForm={areaForm}
        setAreaForm={setAreaForm}
        areaPreview={areaPreview}
        setAreaPreview={setAreaPreview}
        occurrenceForm={occurrenceForm}
        setOccurrenceForm={setOccurrenceForm}
        occurrencePreview={occurrencePreview}
        setOccurrencePreview={setOccurrencePreview}
        isDrawingArea={isDrawingArea}
        draftPolygonCoords={draftPolygonCoords}
        onStartAreaDrawing={startAreaDrawing}
        onConcludeAreaDrawing={concludeAreaDrawing}
        onClearAreaDrawing={clearAreaDrawing}
        onSubmitArea={handleAreaSubmit}
        onSubmitOccurrence={handleOccurrenceSubmit}
        isSavingArea={isSavingArea}
        isSavingOccurrence={isSavingOccurrence}
        areaSuccessMessage={areaSuccessMessage}
        occurrenceSuccessMessage={occurrenceSuccessMessage}
        onCancelArea={() => { resetAreaDraft(); setOpenCard(null); }}
        occurrenceLocation={occurrenceLocation}
        onCancelOccurrence={() => { resetOccurrenceDraft(); setOpenCard(null); }}
      />
      <main className="map-stage">
        <MapContainer center={FALLBACK_CENTER} zoom={12} scrollWheelZoom className="leaflet-map">
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Satélite">
              <TileLayer attribution={SATELLITE_TILES.attribution} url={SATELLITE_TILES.url} />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Mapa padrão">
              <TileLayer attribution={STREET_TILES.attribution} url={STREET_TILES.url} />
            </LayersControl.BaseLayer>
          </LayersControl>
          {boundaryData ? <BoundaryLayer geojson={boundaryData} /> : null}
          <MapClickHandler
            drawingEnabled={isDrawingArea}
            onDrawPoint={(latlng) => {
              setDraftPolygonCoords((current) => {
                const next = [...current, [latlng.lat, latlng.lng]];
                setAreaForm((form) => ({ ...form, polygonCoords: next }));
                return next;
              });
              setOpenCard("area");
            }}
          />
          {draftPolygonCoords.length > 1 ? (
            <Polyline
              positions={draftPolygonCoords}
              pathOptions={{ color: statusToColor(areaForm.status), weight: 4, opacity: 0.95 }}
            />
          ) : null}
          {draftPolygonReady ? (
            <Polygon
              positions={draftPolygonCoords}
              pathOptions={{
                color: statusToColor(areaForm.status),
                weight: 4,
                opacity: 1,
                fillColor: statusToColor(areaForm.status),
                fillOpacity: 0.14,
              }}
              interactive={false}
            />
          ) : null}
          {draftPolygonCoords.map((position, index) => (
            <CircleMarker
              key={`draft-vertex-${index}`}
              center={position}
              radius={6}
              pathOptions={getVertexStyle(areaForm.status)}
              interactive={false}
            />
          ))}
          {draftPolygonCenter ? (
            <CircleMarker center={draftPolygonCenter} radius={1} opacity={0} fillOpacity={0} interactive={false}>
              <Tooltip permanent direction="top" className="selection-tooltip">
                Demarcação em andamento
              </Tooltip>
            </CircleMarker>
          ) : null}
          {areas.map((area) => (
            <AreaFeature
              key={area.id}
              area={area}
              drawingEnabled={isDrawingArea}
              isHovered={hoveredAreaId === area.id}
              isActive={activeAreaId === area.id}
              onHover={() => setHoveredAreaId(area.id)}
              onLeave={() => {
                setHoveredAreaId((current) => (current === area.id ? null : current));
                setActiveAreaId((current) => (current === area.id ? null : current));
              }}
              onToggle={() => setActiveAreaId((current) => current === area.id ? null : area.id)}
              onClose={() => setActiveAreaId((current) => (current === area.id ? null : current))}
              onAreaPointSelect={(point) => {
                setActiveAreaId(area.id);
                setHoveredAreaId(area.id);
                setOccurrenceForm((current) => ({ ...current, areaId: area.id }));
                setOccurrenceLocation(point);
                setOpenCard("occurrence");
              }}
            />
          ))}
          <Pane name="labels-pane" style={{ zIndex: 450, pointerEvents: "none" }}>
            <TileLayer attribution={LABEL_TILES.attribution} url={LABEL_TILES.url} />
          </Pane>
        </MapContainer>
      </main>
    </div>
  );
}

function AreaFeature({ area, drawingEnabled, isHovered, isActive, onHover, onLeave, onToggle, onClose, onAreaPointSelect }) {
  const polygonPositions = area.polygonCoords;
  return (
    <>
      <Polygon
        positions={polygonPositions}
        pathOptions={{
          ...getAreaPolygonStyle(area.status, isHovered || isActive),
          interactive: !drawingEnabled,
        }}
        eventHandlers={
          drawingEnabled
            ? {}
            : {
                click: (event) =>
                  onAreaPointSelect({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
                mouseover: onHover,
                mouseout: onLeave,
              }
        }
      />
      {isActive
        ? polygonPositions.map((position, index) => (
            <CircleMarker
              key={`${area.id}-vertex-${index}`}
              center={position}
              radius={6}
              pathOptions={getVertexStyle(area.status)}
              eventHandlers={{
                click: () =>
                  onAreaPointSelect({
                    latitude: position[0],
                    longitude: position[1],
                  }),
                mouseover: onHover,
                mouseout: onLeave,
              }}
            />
          ))
        : null}
      {!drawingEnabled ? (
        <Marker
          position={[area.latitude, area.longitude]}
          icon={getMarkerIcon(area.status)}
          eventHandlers={{
            click: onToggle,
            mouseover: onHover,
            mouseout: onLeave,
          }}
        >
          {isHovered && !isActive ? (
            <Tooltip direction="top" offset={[0, -18]} opacity={1} className="environment-tooltip">
              <HoverCard area={area} />
            </Tooltip>
          ) : null}
        </Marker>
      ) : null}
      {isHovered && !isActive ? (
        <CircleMarker center={[area.latitude, area.longitude]} radius={1} opacity={0} fillOpacity={0} interactive={false}>
          <Tooltip permanent direction="top" offset={[0, -12]} opacity={1} className="environment-tooltip">
            <HoverCard area={area} />
          </Tooltip>
        </CircleMarker>
      ) : null}
      {isActive ? (
        <Popup position={[area.latitude, area.longitude]} eventHandlers={{ remove: onClose }}>
          <DetailCard area={area} />
        </Popup>
      ) : null}
    </>
  );
}

function Sidebar(props) {
  const { openCard, onToggle, dataMode, dataStatus, areas, areaForm, setAreaForm, areaPreview, setAreaPreview, occurrenceForm, setOccurrenceForm, occurrencePreview, setOccurrencePreview, isDrawingArea, draftPolygonCoords, onStartAreaDrawing, onConcludeAreaDrawing, onClearAreaDrawing, onSubmitArea, onSubmitOccurrence, isSavingArea, isSavingOccurrence, areaSuccessMessage, occurrenceSuccessMessage, onCancelArea, onCancelOccurrence, occurrenceLocation } = props;
  const areaReady = areaForm.polygonCoords.length >= 3 || draftPolygonCoords.length >= 3;
  const selectedOccurrenceArea = areas.find((area) => area.id === occurrenceForm.areaId) ?? null;
  return (
    <aside className="sidebar">
      <div className="sidebar__panel">
        <header className="sidebar__header">
          <span className="eyebrow eyebrow--with-icon">
            <span className="eyebrow__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19.5 4.5c-5.6.2-9.6 1.9-12 5.1-2.2 2.8-3 6.3-2.5 9.9 3.6.5 7.1-.4 9.9-2.5 3.2-2.4 4.9-6.4 5.1-12Z" />
                <path d="M8.2 15.8c2-1.6 4.1-3 6.5-4.1" />
                <path d="M10.7 18.9c.2-1.5-.1-3.1-.8-4.5" />
              </svg>
            </span>
            <span>Monitoramento Ambiental</span>
          </span>
          <h1>Mapa de Atenção Ambiental de Duque Bacelar</h1>
        </header>
        <LegendCard />
        <ExpandableCard kicker="Área protegida" title="Cadastrar Nova Área" isOpen={openCard === "area"} onToggle={() => onToggle("area")}>
          <form className="dark-form" onSubmit={onSubmitArea}>
            <Field label="Nome da área"><input required value={areaForm.name} onChange={(event) => setAreaForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Nascente do Riacho Fundo" /></Field>
            <Field label="Categoria">
              <CategoriaSelect
                value={areaForm.category}
                onChange={(value) => setAreaForm((current) => ({ ...current, category: value }))}
              />
            </Field>
            <Field label="Status"><select value={areaForm.status} onChange={(event) => setAreaForm((current) => ({ ...current, status: event.target.value }))}><option value="preservado">Preservado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></Field>
            <Field label="Impacto"><input required value={areaForm.impact} onChange={(event) => setAreaForm((current) => ({ ...current, impact: event.target.value }))} placeholder="Ex.: Pressão moderada por descarte irregular" /></Field>
            <Field label="Descrição"><textarea required rows="4" value={areaForm.description} onChange={(event) => setAreaForm((current) => ({ ...current, description: event.target.value }))} placeholder="Descreva rapidamente a situação observada." /></Field>
            <section className="demarcation-panel">
              <div className="demarcation-panel__header">
                <div className="demarcation-panel__intro">
                  <h3>Demarque a área</h3>
                </div>
              </div>

              <button
                type="button"
                className={`btn btn--green btn--primary-action${!isDrawingArea ? " btn--pulse" : ""}`}
                onClick={onStartAreaDrawing}
              >
                Iniciar demarcação
              </button>

              <div className="drawing-actions drawing-actions--secondary">
                <button type="button" className="btn btn--ghost" onClick={onConcludeAreaDrawing} disabled={draftPolygonCoords.length < 3}>
                  Concluir
                </button>
                <button type="button" className="btn btn--subtle" onClick={onClearAreaDrawing}>
                  Limpar
                </button>
              </div>

              <div className={`demarcation-status${areaReady ? " demarcation-status--success" : ""}`}>
                {areaReady ? "Área demarcada com sucesso." : "Adicione pelo menos 3 pontos para formar a área."}
              </div>
            </section>
            {areaSuccessMessage ? <div className="form-feedback form-feedback--success">{areaSuccessMessage}</div> : null}
            <UploadBox preview={areaPreview} onPreviewChange={setAreaPreview} />
            <div className="form-actions"><button className="btn btn--green" type="submit" disabled={isSavingArea}>{isSavingArea ? "Salvando..." : "Salvar área"}</button><button className="btn btn--red" type="button" onClick={onCancelArea} disabled={isSavingArea}>Cancelar</button></div>
          </form>
        </ExpandableCard>
        <ExpandableCard kicker="Registro de campo" title="Registrar Ocorrência" isOpen={openCard === "occurrence"} onToggle={() => onToggle("occurrence")}>
          <form className="dark-form" onSubmit={onSubmitOccurrence}>
            <Field label="Área vinculada"><select required value={occurrenceForm.areaId} onChange={(event) => setOccurrenceForm((current) => ({ ...current, areaId: event.target.value }))}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
            <div className="status-reference">
              <span className="status-reference__label">Categoria da área</span>
              <strong>{selectedOccurrenceArea ? selectedOccurrenceArea.category : "Selecione uma área"}</strong>
            </div>
            <div className="status-reference">
              <span className="status-reference__label">Status atual da área</span>
              <strong className={`impact-pill impact-pill--${selectedOccurrenceArea?.status ?? "atencao"}`}>
                {selectedOccurrenceArea ? statusLabel(selectedOccurrenceArea.status) : "Selecione uma área"}
              </strong>
            </div>
            <label className="status-toggle">
              <input
                type="checkbox"
                checked={occurrenceForm.updateStatus}
                onChange={(event) =>
                  setOccurrenceForm((current) => ({
                    ...current,
                    updateStatus: event.target.checked,
                    nextStatus: event.target.checked
                      ? current.nextStatus || selectedOccurrenceArea?.status || "atencao"
                      : "",
                  }))
                }
              />
              <span>Atualizar status da área nesta ocorrência</span>
            </label>
            {occurrenceForm.updateStatus ? (
              <Field label="Novo status da área">
                <select
                  value={occurrenceForm.nextStatus}
                  onChange={(event) =>
                    setOccurrenceForm((current) => ({ ...current, nextStatus: event.target.value }))
                  }
                >
                  <option value="preservado">Preservado</option>
                  <option value="atencao">Em atenção</option>
                  <option value="critico">Crítico</option>
                </select>
              </Field>
            ) : null}
            {selectedOccurrenceArea && occurrenceForm.updateStatus && occurrenceForm.nextStatus ? (
              <div className="map-helper map-helper--selected">
                <strong>
                  Status atualizado: {statusUpdateLabel(selectedOccurrenceArea.status)} {"\u2192"} {statusUpdateLabel(occurrenceForm.nextStatus)}
                </strong>
              </div>
            ) : null}
            <Field label="Impacto observado"><input required value={occurrenceForm.impact} onChange={(event) => setOccurrenceForm((current) => ({ ...current, impact: event.target.value }))} placeholder="Ex.: Risco alto de contaminação do solo" /></Field>
            <Field label="Detalhes"><textarea required rows="4" value={occurrenceForm.description} onChange={(event) => setOccurrenceForm((current) => ({ ...current, description: event.target.value }))} placeholder="Registre a ocorrência dentro do próprio card." /></Field>
            {occurrenceLocation ? (
              <div className="map-helper map-helper--selected">
                <strong>
                  Ocorrência vinculada a esta área no ponto {occurrenceLocation.latitude.toFixed(6)}, {occurrenceLocation.longitude.toFixed(6)}.
                </strong>
              </div>
            ) : null}
            {selectedOccurrenceArea ? (
              <div className={`map-helper${selectedOccurrenceArea.statusUpdated ? " map-helper--selected" : ""}`}>
                {selectedOccurrenceArea.statusUpdated && selectedOccurrenceArea.previousStatus ? (
                  <strong>
                    Última atualização alterou o status de {statusUpdateLabel(selectedOccurrenceArea.previousStatus)} para {statusUpdateLabel(selectedOccurrenceArea.status)}.
                  </strong>
                ) : (
                  <span>Última ocorrência registrada manteve o status atual da área.</span>
                )}
              </div>
            ) : null}
            {occurrenceSuccessMessage ? <div className="form-feedback form-feedback--success">{occurrenceSuccessMessage}</div> : null}
            <UploadBox preview={occurrencePreview} onPreviewChange={setOccurrencePreview} />
            <div className="form-actions"><button className="btn btn--green" type="submit" disabled={isSavingOccurrence}>{isSavingOccurrence ? "Registrando..." : "Registrar"}</button><button className="btn btn--red" type="button" onClick={onCancelOccurrence} disabled={isSavingOccurrence}>Cancelar</button></div>
          </form>
        </ExpandableCard>
      </div>
    </aside>
  );
}

function LegendCard() {
  return <section className="legend-card"><div className="legend-card__title-row"><h2>Legenda</h2><span className="legend-card__badge">Status</span></div><div className="legend-list"><div className="legend-item"><span className="legend-swatch legend-swatch--green"></span><span>Preservado</span></div><div className="legend-item"><span className="legend-swatch legend-swatch--yellow"></span><span>Atenção</span></div><div className="legend-item"><span className="legend-swatch legend-swatch--red"></span><span>Crítico</span></div></div></section>;
}

function BoundaryLayer({ geojson }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(geojson);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
  }, [geojson, map]);
  return <GeoJSON data={geojson} style={BOUNDARY_STYLE} />;
}

function MapClickHandler({ drawingEnabled, onDrawPoint }) {
  useMapEvents({
    click(event) {
      if (!drawingEnabled) return;
      onDrawPoint(event.latlng);
    },
  });
  return null;
}

function ExpandableCard({ kicker, title, isOpen, onToggle, children }) {
  return <section className="action-card" data-open={isOpen}><button className="action-card__toggle" type="button" onClick={onToggle} aria-expanded={isOpen}><div><span className="action-card__kicker">{kicker}</span><h2>{title}</h2></div><span className="action-card__icon">+</span></button>{isOpen ? <div className="action-card__content">{children}</div> : null}</section>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function CategoriaSelect({ value, onChange }) {
  const isCustomCategory = value && !CATEGORIES.includes(value);
  const selectedValue = isCustomCategory ? "Outro" : value;

  return (
    <div className="category-select-wrap">
      <select
        value={selectedValue}
        onChange={(event) => onChange(event.target.value === "Outro" ? "" : event.target.value)}
      >
        <option value="">Selecione uma categoria</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>

      {selectedValue === "Outro" ? (
        <input
          type="text"
          value={isCustomCategory ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Digite a categoria..."
        />
      ) : null}
    </div>
  );
}

function UploadBox({ preview, onPreviewChange }) {
  const [isDragOver, setIsDragOver] = useState(false);
  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onPreviewChange(reader.result);
    reader.readAsDataURL(file);
  }
  return <label className={`upload-box${isDragOver ? " is-dragover" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }} onDragLeave={(event) => { event.preventDefault(); setIsDragOver(false); }} onDrop={(event) => { event.preventDefault(); setIsDragOver(false); handleFile(event.dataTransfer.files?.[0]); }}><input className="upload-box__input" type="file" accept="image/*" onChange={(event) => handleFile(event.target.files?.[0])} />{preview ? <div className="upload-box__preview"><img src={preview} alt="Pre-visualizacao da imagem enviada" /><button type="button" className="upload-box__remove" onClick={(event) => { event.preventDefault(); onPreviewChange(null); }}>Remover imagem</button></div> : <div className="upload-box__prompt"><strong>Arraste uma imagem ou clique para selecionar</strong><span>PNG, JPG ou WEBP</span></div>}</label>;
}

function DetailCard({ area }) {
  return <article className="detail-card"><img src={area.image} alt={area.name} /><div className="detail-card__body"><h3>{area.name}</h3><div className="meta-row"><span>{area.category}</span><span>{statusLabel(area.status)}</span></div><p>{area.description}</p><span className={`impact-pill impact-pill--${area.status}`}>{area.impact}</span></div></article>;
}

function HoverCard({ area }) {
  return <article className="hover-card"><img src={area.image} alt={area.name} /><div className="hover-card__body"><h3>{area.name}</h3><div className="meta-row"><span>{area.category}</span><span>{statusLabel(area.status)}</span></div><p>{area.impact}</p><span className={`impact-pill impact-pill--${area.status}`}>{statusLabel(area.status)}</span></div></article>;
}

function areaSeed(name, category, status, impact, description, polygonCoords) {
  const [latitude, longitude] = computeCentroid(polygonCoords);
  return { id: createId(), name, category, status, impact, description, polygonCoords, latitude, longitude, image: createPlaceholderImage(name, statusToColor(status)) };
}

function emptyAreaForm() {
  return { name: "", category: "", status: "preservado", impact: "", description: "", polygonCoords: [] };
}

function emptyOccurrenceForm(areaId = "") {
  return {
    areaId,
    impact: "",
    description: "",
    updateStatus: false,
    nextStatus: "",
  };
}

function loadAreas() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const source = Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_AREAS;
    return source.map(normalizeAreaShape);
  } catch {
    return DEFAULT_AREAS.map(normalizeAreaShape);
  }
}

function mapSupabaseAreaToApp(row) {
  if (!row) return null;
  const polygonCoords = normalizePolygonCoords(row.polygon_coords, row.latitude, row.longitude);
  const [latitude, longitude] = computeCentroid(polygonCoords);
  return {
    id: String(row.id),
    name: row.name ?? "Área sem nome",
    category: row.category ?? "Sem categoria",
    status: row.status ?? "atencao",
    impact: row.impact ?? "Sem impacto informado",
    description: row.description ?? "Sem descrição informada",
    polygonCoords,
    latitude,
    longitude,
    image: row.image_url || createPlaceholderImage(row.name ?? "Área monitorada", statusToColor(row.status ?? "atencao")),
  };
}

function normalizeAreaShape(area) {
  const polygonCoords = normalizePolygonCoords(area?.polygonCoords, area?.latitude, area?.longitude);
  const [latitude, longitude] = computeCentroid(polygonCoords);
  return { ...area, polygonCoords, latitude, longitude };
}

function normalizePolygonCoords(coords, fallbackLatitude, fallbackLongitude) {
  if (
    Array.isArray(coords) &&
    coords.length >= 3 &&
    coords.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number",
    )
  ) {
    return coords;
  }

  return createAreaPolygon(
    Number(fallbackLatitude) || FALLBACK_CENTER[0],
    Number(fallbackLongitude) || FALLBACK_CENTER[1],
  );
}

function normalizeAreaName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getMarkerIcon(status) {
  return L.divIcon({
    className: "environment-marker-icon",
    html: `<span class="environment-marker environment-marker--${status}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function getAreaPolygonStyle(status, isHighlighted) {
  const color = statusToColor(status);

  return {
    color,
    weight: isHighlighted ? 4 : 0,
    opacity: isHighlighted ? 1 : 0,
    fillColor: color,
    fillOpacity: isHighlighted ? 0.22 : 0.12,
  };
}

function getVertexStyle(status) {
  return {
    color: statusToColor(status),
    weight: 3,
    fillColor: "#f8fbff",
    fillOpacity: 1,
  };
}

function createAreaPolygon(latitude, longitude) {
  const latOffset = 0.012;
  const lngOffset = 0.016;

  return [
    [latitude - latOffset * 0.55, longitude - lngOffset],
    [latitude - latOffset, longitude - lngOffset * 0.18],
    [latitude - latOffset * 0.35, longitude + lngOffset * 0.86],
    [latitude + latOffset * 0.55, longitude + lngOffset],
    [latitude + latOffset, longitude + lngOffset * 0.08],
    [latitude + latOffset * 0.4, longitude - lngOffset * 0.92],
  ];
}

function computeCentroid(coords) {
  const total = coords.reduce(
    (accumulator, point) => [accumulator[0] + point[0], accumulator[1] + point[1]],
    [0, 0],
  );

  return [total[0] / coords.length, total[1] / coords.length];
}

function statusLabel(status) {
  if (status === "preservado") return "Preservado";
  if (status === "atencao") return "Atenção";
  return "Crítico";
}

function statusUpdateLabel(status) {
  if (status === "preservado") return "Preservado";
  if (status === "atencao") return "Em atenção";
  return "Crítico";
}

function statusToColor(status) {
  if (status === "preservado") return "#2fb36f";
  if (status === "atencao") return "#e8ba39";
  return "#dd5757";
}

function createPlaceholderImage(title, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460"><defs><linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="${color}" stop-opacity="0.96" /><stop offset="100%" stop-color="#08111f" stop-opacity="1" /></linearGradient></defs><rect width="800" height="460" fill="url(#g)" /><circle cx="680" cy="90" r="72" fill="rgba(255,255,255,0.12)" /><path d="M0 350 C140 280, 220 390, 360 320 S580 235, 800 335 L800 460 L0 460 Z" fill="rgba(255,255,255,0.1)" /><text x="48" y="110" fill="#f8fbff" font-family="Segoe UI, sans-serif" font-size="22">Monitoramento Ambiental</text><text x="48" y="156" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="36" font-weight="700">${escapeHtml(title)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createId() {
  return typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `area-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}



