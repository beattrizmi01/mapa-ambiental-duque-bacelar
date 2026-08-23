import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import {
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
import duqueBacelarLimiteRaw from "./data/duque-bacelar-limite.geojson?raw";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

const STORAGE_KEY = "mapa-ambiental-duque-bacelar:areas:v2";
const MOBILE_HELP_KEY = "mapa-ambiental-duque-bacelar:mobile-help:v1";
const IMAGE_PRELOAD_CACHE = new Map();
const DUQUE_BACELAR_BOUNDARY = JSON.parse(duqueBacelarLimiteRaw);
const FALLBACK_CENTER = [-4.1533881, -42.9459142];
const REGIONAL_CENTER = [-4.62, -43.72];
const LOCAL_ZOOM = 12;
const MAX_MAP_ZOOM = 20;
const DEFAULT_LAYER_FILTERS = {
  preservado: true,
  atencao: true,
  critico: true,
};
const REGIONS = [
  { id: "duque-bacelar", name: "Duque Bacelar", center: FALLBACK_CENTER, zoom: 11 },
];
const BOUNDARY_STYLE = { color: "#7fb5ff", weight: 1.4, fillColor: "transparent", fillOpacity: 0 };
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
const CATEGORY_HINTS = {
  "Vegetação nativa": "matas, florestas e cerrado",
  "Fauna": "animais silvestres e habitats",
  "Recursos hídricos": "rios, lagos e nascentes",
  "Áreas de preservação": "APPs, reservas e unidades protegidas",
  "Áreas degradadas": "desmatamento, erosão e solo exposto",
  "Impactos ambientais": "poluição, queimadas e descarte irregular",
  "Registros científicos": "pesquisas, coletas e observações",
  "Educação ambiental": "ações, projetos e campanhas",
  "Outro": "categoria não listada",
};
const SEARCH_RESULT_ICON = L.divIcon({
  className: "search-result-marker",
  html: '<span aria-hidden="true"></span>',
  iconSize: [34, 42],
  iconAnchor: [17, 42],
});
const RESPONSIBLE_ROLES = [
  "Professor(a)",
  "Pesquisador(a)",
  "Aluno(a) / Estudante",
  "Engenheiro(a) ambiental",
  "Biólogo(a)",
  "Geógrafo(a)",
  "Técnico(a) ambiental",
  "Fiscal ambiental",
  "Servidor(a) público(a)",
  "Representante de órgão ambiental",
  "Agricultor(a) / Produtor(a) rural",
  "Morador(a) / Comunidade local",
  "Representante de ONG",
];
export default function App() {
  const [openCard, setOpenCard] = useState(null);
  const [areas, setAreas] = useState(() => loadAreas());
  const [activeBaseMap, setActiveBaseMap] = useState("satellite");
  const [showMapLabels, setShowMapLabels] = useState(false);
  const [baseMapReady, setBaseMapReady] = useState(false);
  const [layerFilters, setLayerFilters] = useState(DEFAULT_LAYER_FILTERS);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  const boundaryData = DUQUE_BACELAR_BOUNDARY;
  const [dataMode, setDataMode] = useState(hasSupabaseConfig() ? "supabase" : "local");
  const [dataStatus, setDataStatus] = useState(hasSupabaseConfig() ? "Conectando ao Supabase..." : "Usando armazenamento local do navegador.");
  const [selectedRegionId, setSelectedRegionId] = useState(REGIONS[0].id);
  const [availableRegions, setAvailableRegions] = useState(REGIONS);
  const [isRegionPanelOpen, setIsRegionPanelOpen] = useState(false);
  const [occurrenceRecords, setOccurrenceRecords] = useState([]);
  const [statusHistory, setStatusHistory] = useState([]);
  const [statusChangeNotice, setStatusChangeNotice] = useState(null);
  const [recentlyUpdatedAreaId, setRecentlyUpdatedAreaId] = useState(null);
  const [hoveredAreaId, setHoveredAreaId] = useState(null);
  const [activeAreaId, setActiveAreaId] = useState(null);
  const [detailOrigin, setDetailOrigin] = useState(null);
  const [mapFocus, setMapFocus] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [searchedLocation, setSearchedLocation] = useState(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
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
  const [areaErrorMessage, setAreaErrorMessage] = useState("");
  const [occurrenceSuccessMessage, setOccurrenceSuccessMessage] = useState("");
  const [occurrenceErrorMessage, setOccurrenceErrorMessage] = useState("");
  const [showMobileTips, setShowMobileTips] = useState(false);
  const [createdAreaForOccurrence, setCreatedAreaForOccurrence] = useState(null);
  const draftPolygonReady = draftPolygonCoords.length >= 3;
  const draftPolygonCenter = useMemo(
    () => (draftPolygonCoords.length ? computeCentroid(draftPolygonCoords) : null),
    [draftPolygonCoords],
  );
  const selectedRegion = availableRegions.find((region) => region.id === selectedRegionId) ?? availableRegions[0] ?? REGIONS[0];
  const regionAreas = useMemo(() => filterAreasByRegion(areas, selectedRegion.name), [areas, selectedRegion.name]);
  const regionOccurrenceCount = useMemo(
    () => countOccurrencesForAreas(occurrenceRecords, regionAreas),
    [occurrenceRecords, regionAreas],
  );
  const regionSummary = useMemo(() => createRegionSummary(regionAreas, regionOccurrenceCount), [regionAreas, regionOccurrenceCount]);
  const notificationSummary = useMemo(
    () => createNotificationSummary(areas, occurrenceRecords),
    [areas, occurrenceRecords],
  );
  const visibleAreas = useMemo(
    () => filterAreasByLayers(regionAreas, layerFilters),
    [regionAreas, layerFilters],
  );
  const visibleOccurrenceRecords = occurrenceRecords;
  const hasRegionData = regionAreas.length > 0;

  function toggleLayerFilter(filterKey) {
    setLayerFilters((current) => ({ ...current, [filterKey]: !current[filterKey] }));
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncViewport = (event) => {
      setIsMobileViewport(event.matches);
    };

    setIsMobileViewport(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth > 900) return;
    if (!window.localStorage.getItem(MOBILE_HELP_KEY)) {
      setShowMobileTips(true);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!locationNotice || isLocatingUser) return undefined;
    const timer = window.setTimeout(() => setLocationNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [isLocatingUser, locationNotice]);

  useEffect(() => {
    setBaseMapReady(false);
    setShowMapLabels(false);
  }, [activeBaseMap]);

  useEffect(() => {
    if (!baseMapReady) return undefined;
    const timer = window.setTimeout(() => setShowMapLabels(true), isMobileViewport ? 2500 : 500);
    return () => window.clearTimeout(timer);
  }, [baseMapReady, isMobileViewport]);

  useEffect(() => {
    let active = true;
    async function loadFromSupabase() {
      if (!hasSupabaseConfig()) return;
      const { data, error } = await supabase
        .from("areas")
        .select("id, name, category, region, status, impact, description, polygon_coords, latitude, longitude, created_at")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        console.error(error);
        setDataMode("local");
        setDataStatus("Não foi possível carregar do Supabase. Exibindo dados locais.");
        return;
      }
      const mapped = (data ?? []).map(mapSupabaseAreaToApp).filter(Boolean);
      setAreas(mapped);
      setAvailableRegions((current) => mergeRegions(current, regionsFromAreas(mapped)));
      try {
        const lightweightAreas = mapped.map((area) => ({
          ...area,
          image: typeof area.image === "string" && !area.image.startsWith("data:") ? area.image : "",
        }));
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweightAreas));
      } catch (cacheError) {
        console.warn("Não foi possível atualizar a cópia rápida das áreas.", cacheError);
      }
      const [occurrenceResult, historyResult] = await Promise.all([
        supabase
          .from("occurrences")
          .select("id, area_id, impact, description, previous_status, new_status, status_updated, created_by, created_at"),
        supabase
          .from("area_status_history")
          .select("id, area_id, occurrence_id, previous_status, new_status, occurrence_impact, occurrence_description, changed_by, changed_at")
          .order("changed_at", { ascending: false }),
      ]);
      if (!active) return;
      if (!occurrenceResult.error) {
        setOccurrenceRecords(occurrenceResult.data ?? []);
      }
      if (!historyResult.error) {
        setStatusHistory((historyResult.data ?? []).map(mapStatusHistoryRowToApp));
      } else {
        const { data: fallbackHistoryRows, error: fallbackHistoryError } = await supabase
          .from("area_status_history")
          .select("id, area_id, occurrence_id, previous_status, new_status, changed_by, changed_at, occurrences(id, impact, description, created_at, created_by)")
          .order("changed_at", { ascending: false });
        if (!active) return;
        if (!fallbackHistoryError) {
          setStatusHistory((fallbackHistoryRows ?? []).map(mapStatusHistoryRowToApp));
        }
      }
      setDataMode("supabase");
      setDataStatus(mapped.length ? `Exibindo ${mapped.length} registro(s) do Supabase.` : "Supabase conectado, mas nenhuma área foi encontrada ainda.");
    }
    loadFromSupabase();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hasSupabaseConfig() || typeof window === "undefined") return;
    try {
      const lightweightAreas = areas.map((area) => ({
        ...area,
        image: typeof area.image === "string" && !area.image.startsWith("data:") ? area.image : "",
      }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweightAreas));
    } catch (error) {
      console.warn("Não foi possível salvar as áreas no armazenamento local.", error);
      setDataStatus("O armazenamento local está cheio. Os dados já salvos continuam disponíveis.");
    }
  }, [areas]);

  useEffect(() => {
    setAvailableRegions((current) => mergeRegions(current, regionsFromAreas(areas)));
  }, [areas]);

  useEffect(() => {
    if (!statusChangeNotice) return undefined;
    const timer = window.setTimeout(() => setStatusChangeNotice(null), 6200);
    return () => window.clearTimeout(timer);
  }, [statusChangeNotice]);

  useEffect(() => {
    if (!recentlyUpdatedAreaId) return undefined;
    const timer = window.setTimeout(() => setRecentlyUpdatedAreaId(null), 12000);
    return () => window.clearTimeout(timer);
  }, [recentlyUpdatedAreaId]);

  function resetAreaDraft() {
    setAreaForm(emptyAreaForm());
    setAreaPreview(null);
    setDraftPolygonCoords([]);
    setIsDrawingArea(false);
    setAreaSuccessMessage("");
    setAreaErrorMessage("");
  }

  function resetOccurrenceDraft() {
    setOccurrenceForm(emptyOccurrenceForm(areas[0]?.id ?? ""));
    setOccurrencePreview(null);
    setOccurrenceLocation(null);
    setOccurrenceSuccessMessage("");
    setOccurrenceErrorMessage("");
  }

  function closeHelp() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MOBILE_HELP_KEY, "seen");
    }
    setOpenCard(null);
  }

  function dismissMobileTips() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MOBILE_HELP_KEY, "seen");
    }
    setShowMobileTips(false);
  }

  function openOccurrenceFlow() {
    const selectedArea = areas.find((area) => area.id === activeAreaId) ?? null;
    if (!selectedArea) {
      setOpenCard("occurrence-guide");
      return;
    }
    setOccurrenceForm((current) => ({ ...current, areaId: selectedArea.id }));
    setOpenCard("occurrence");
  }

  function startAreaDrawing() {
    setOpenCard(null);
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
    setOpenCard("area");
    setDataStatus(`Área demarcada com ${draftPolygonCoords.length} vértices. Agora preencha os dados e salve.`);
  }

  function clearAreaDrawing() {
    setDraftPolygonCoords([]);
    setAreaForm((current) => ({ ...current, polygonCoords: [] }));
    setDataStatus("Demarcação limpa. Clique no mapa para começar novamente.");
  }

  async function locateUser() {
    await detectUserRegion();
  }

  async function locateAndStartDrawing() {
    setOpenCard(null);
    const located = await detectUserRegion();
    if (located) startAreaDrawing();
  }

  async function searchLocation(query) {
    const searchTerm = query.trim();
    if (!searchTerm) return;
    setDataStatus(`Buscando ${searchTerm}...`);
    try {
      const coordinateMatch = searchTerm.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
      let latitude;
      let longitude;
      let regionName = searchTerm;
      if (coordinateMatch) {
        latitude = Number(coordinateMatch[1]);
        longitude = Number(coordinateMatch[2]);
        regionName = await reverseGeocodeCity(latitude, longitude) || searchTerm;
      } else {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("q", searchTerm);
        url.searchParams.set("limit", "1");
        url.searchParams.set("addressdetails", "1");
        const response = await fetch(url.toString(), { headers: { "Accept-Language": "pt-BR,pt;q=0.9" } });
        if (!response.ok) throw new Error("Busca indisponível");
        const [result] = await response.json();
        if (!result) throw new Error("Local não encontrado");
        latitude = Number(result.lat);
        longitude = Number(result.lon);
        const address = result.address ?? {};
        regionName = address.city || address.town || address.municipality || address.village || result.name || searchTerm;
      }
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Coordenadas inválidas");
      const detectedRegion = createRegion(
        getRegionNameAtPoint(boundaryData, latitude, longitude) || regionName,
        [latitude, longitude],
        LOCAL_ZOOM,
      );
      setAvailableRegions((current) => mergeRegions(current, [detectedRegion]));
      setSelectedRegionId(detectedRegion.id);
      setSearchedLocation({ latitude, longitude, name: detectedRegion.name });
      setMapFocus({ id: `search-${Date.now()}`, center: [latitude, longitude], zoom: Math.max(14, detectedRegion.zoom) });
      setDataStatus(`Local encontrado: ${detectedRegion.name}.`);
      return detectedRegion;
    } catch {
      setDataStatus("Não foi possível encontrar esse local. Tente cidade, estado ou latitude e longitude.");
      return null;
    }
  }

  async function searchAndStartAreaDrawing(query) {
    setAreaErrorMessage("");
    const detectedRegion = await searchLocation(query);
    if (!detectedRegion) {
      setAreaErrorMessage("Local não encontrado. Tente informar cidade, estado ou latitude e longitude.");
      setOpenCard("area");
      return false;
    }
    startAreaDrawing();
    setDataStatus(`Local encontrado: ${detectedRegion.name}. Toque no mapa para marcar os limites da área.`);
    return true;
  }

  async function detectUserRegion() {
    const canUseDeviceGps = typeof navigator !== "undefined"
      && Boolean(navigator.geolocation)
      && (typeof window === "undefined" || window.isSecureContext);

    setIsLocatingUser(true);
    setDataStatus("Buscando sua localização atual...");
    setLocationNotice("Solicitando a localização do dispositivo...");

    async function displayDetectedLocation(nextLocation, suggestedCity = "") {
      const boundaryRegionName = getRegionNameAtPoint(
        boundaryData,
        nextLocation.latitude,
        nextLocation.longitude,
      );
      setUserLocation(nextLocation);
      setMapFocus({
        id: `user-location-${Date.now()}`,
        center: [nextLocation.latitude, nextLocation.longitude],
        zoom: nextLocation.approximate ? 12 : LOCAL_ZOOM,
      });
      let cityName = suggestedCity;
      try {
        cityName = boundaryRegionName || cityName || await reverseGeocodeCity(nextLocation.latitude, nextLocation.longitude);
      } catch {
        // A localização continua válida mesmo se o serviço de nome da cidade falhar.
      }
      const detectedRegion = createRegion(cityName || selectedRegion.name, [nextLocation.latitude, nextLocation.longitude], nextLocation.approximate ? 12 : LOCAL_ZOOM);
      setAvailableRegions((current) => mergeRegions(current, [detectedRegion]));
      setSelectedRegionId(detectedRegion.id);
      setMapFocus({
        id: `detected-region-${detectedRegion.id}-${Date.now()}`,
        center: detectedRegion.center,
        zoom: detectedRegion.zoom,
      });
      setDataStatus(
        regionHasAreas(areas, detectedRegion.name)
          ? `Região detectada: ${detectedRegion.name}. Dados carregados.`
          : `Região detectada: ${detectedRegion.name}. Ainda não há áreas monitoradas nesta região.`,
      );
      setLocationNotice(`${nextLocation.approximate ? "Localização aproximada" : "Localização encontrada"}: ${detectedRegion.name}.`);
      return true;
    }

    try {
      if (!canUseDeviceGps) throw new Error("GPS_UNAVAILABLE");
      const position = await getBrowserPosition();
      const nextLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      return await displayDetectedLocation(nextLocation);
    } catch (error) {
      const denied = error?.code === error?.PERMISSION_DENIED || error?.code === 1;
      setUserLocation(null);
      setDataStatus("Não foi possível detectar sua localização. Região atual mantida.");
      setLocationNotice(denied
        ? "Localização bloqueada pelo navegador. Libere a localização deste site e tente novamente."
        : error?.code === 3
          ? "O GPS demorou para responder. Verifique se a localização está ativada e tente novamente."
          : "Não foi possível obter a localização. Verifique se o GPS está ativado.");
      return false;
    } finally {
      setIsLocatingUser(false);
    }
  }

  function handleRegionChange(regionId, regionName = "") {
    const region = availableRegions.find((item) => item.id === regionId) ?? createRegion(regionName || regionId);
    if (!region) return;
    setAvailableRegions((current) => mergeRegions(current, [region]));
    setSelectedRegionId(region.id);
    setMapFocus({
      id: `region-${region.id}-${Date.now()}`,
      center: region.center,
      zoom: region.zoom,
    });
    setDataStatus(`Região alterada para ${region.name}. Resumo atualizado.`);
  }

  function goToHome() {
    setOpenCard(null);
    setActiveAreaId(null);
    setHoveredAreaId(null);
    setDetailOrigin(null);
    setSearchedLocation(null);
    setIsDrawingArea(false);
    setDraftPolygonCoords([]);
    setMapFocus({
      id: `home-${Date.now()}`,
      center: selectedRegion.center,
      zoom: selectedRegion.zoom,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAreaFromStatus(area) {
    setOpenCard(null);
    setDetailOrigin("status");
    setActiveAreaId(area.id);
    setHoveredAreaId(null);
    setOccurrenceForm((current) => ({ ...current, areaId: area.id }));
    setMapFocus(createMapFocus(area));
    loadAreaImage(area.id);
  }

  async function loadAreaImage(areaId) {
    if (!hasSupabaseConfig()) return;
    const currentArea = areas.find((area) => String(area.id) === String(areaId));
    const currentImage = currentArea?.image ?? "";
    if (currentImage && !currentImage.startsWith("data:image/svg+xml")) return;

    const { data, error } = await supabase
      .from("areas")
      .select("image_url")
      .eq("id", areaId)
      .single();
    if (error || !data?.image_url) return;
    await preloadImageSource(data.image_url);
    setAreas((current) => current.map((area) =>
      String(area.id) === String(areaId) ? { ...area, image: data.image_url } : area,
    ));
  }

  async function handleAreaSubmit(event) {
    event.preventDefault();
    setAreaSuccessMessage("");
    setAreaErrorMessage("");

    const requiredAreaFields = [
      [areaForm.reporterName, "Informe o nome de quem está realizando o cadastro."],
      [areaForm.reporterRole, "Informe a função ou o órgão de quem está realizando o cadastro."],
      [areaForm.name, "Informe o nome da área."],
      [areaForm.category, "Informe a categoria da área."],
      [areaForm.status, "Informe o status da área."],
      [areaForm.impact, "Informe o impacto observado."],
      [areaForm.description, "Informe a descrição da área."],
    ];
    const missingAreaField = requiredAreaFields.find(([value]) => !String(value ?? "").trim());
    if (missingAreaField) {
      setDataStatus(missingAreaField[1]);
      setAreaErrorMessage(`Cadastro não realizado. ${missingAreaField[1]}`);
      setOpenCard("area");
      return;
    }

    if (!areaPreview) {
      setDataStatus("Envie uma imagem da área para concluir o cadastro.");
      setAreaErrorMessage("Cadastro não realizado. A imagem da área é obrigatória.");
      setOpenCard("area");
      return;
    }

    const normalizedName = normalizeAreaName(areaForm.name);
    const duplicateArea = areas.find((area) => normalizeAreaName(area.name) === normalizedName);
    if (duplicateArea) {
      setDataStatus("Já existe uma área cadastrada com esse nome. Escolha outro nome para continuar.");
      setAreaErrorMessage("Cadastro não realizado. Já existe uma área com esse nome.");
      setOpenCard("area");
      return;
    }

    const polygonCoords = areaForm.polygonCoords.length ? areaForm.polygonCoords : draftPolygonCoords;
    if (polygonCoords.length < 3) {
      setDataStatus("Desenhe a área no mapa e conclua a demarcação antes de salvar.");
      setAreaErrorMessage("Cadastro não realizado. Demarque a área com pelo menos 3 pontos e toque em Concluir.");
      setOpenCard("area");
      return;
    }

    setIsSavingArea(true);

    const [latitude, longitude] = computeCentroid(polygonCoords);

    const draft = {
      id: createId(),
      name: areaForm.name.trim(),
      category: areaForm.category.trim(),
      region: selectedRegion.name,
      status: areaForm.status,
      impact: areaForm.impact.trim(),
      description: `${areaForm.description.trim()}\n\nCadastrado por: ${areaForm.reporterName.trim()} — ${areaForm.reporterRole.trim()}`,
      polygonCoords,
      latitude,
    longitude,
    image: areaPreview ?? createPlaceholderImage(areaForm.name.trim(), statusToColor(areaForm.status)),
    createdAt: new Date().toISOString(),
    };
    if (hasSupabaseConfig()) {
      try {
        const { data, error } = await supabase.from("areas").insert({
          name: draft.name,
          category: draft.category,
          region: draft.region,
          status: draft.status,
          impact: draft.impact,
          description: draft.description,
          latitude: draft.latitude,
          longitude: draft.longitude,
          image_url: draft.image,
          polygon_coords: draft.polygonCoords,
        }).select().single();
        if (error) throw error;
        const mapped = mapSupabaseAreaToApp(data) ?? draft;
        setDataMode("supabase");
        setDataStatus("Nova área salva e sincronizada com o Supabase.");
        setAreas((current) => [mapped, ...current]);
        setActiveAreaId(null);
        setMapFocus(createMapFocus(mapped));
        setAreaSuccessMessage("Área cadastrada com sucesso no banco de dados.");
        setCreatedAreaForOccurrence(mapped);
      } catch (error) {
        console.error(error);
        const friendlyError = getSupabaseFriendlyError(error);
        setDataMode("supabase");
        setDataStatus("Cadastro não realizado. A área não foi salva no banco de dados.");
        setAreaErrorMessage(`Cadastro não realizado. Verifique sua conexão e tente novamente. ${friendlyError}`);
        setIsSavingArea(false);
        setOpenCard("area");
        return;
      }
    } else {
      setAreas((current) => [draft, ...current]);
      setDataStatus("Supabase não configurado. A área foi salva apenas neste navegador, não no banco de dados.");
      setActiveAreaId(null);
      setMapFocus(createMapFocus(draft));
      setAreaSuccessMessage("Área salva localmente. Configure o Supabase para salvar no banco de dados.");
      setCreatedAreaForOccurrence(draft);
    }
    setIsSavingArea(false);
    resetAreaDraft();
    setOpenCard("area-created");
  }

  async function handleOccurrenceSubmit(event) {
    event.preventDefault();
    setOccurrenceSuccessMessage("");
    setOccurrenceErrorMessage("");

    const targetArea = areas.find((area) => area.id === occurrenceForm.areaId);
    if (!targetArea) {
      setDataStatus("Selecione uma área válida para registrar a ocorrência.");
      return;
    }

    if (!occurrenceForm.reporterName.trim() || !occurrenceForm.reporterRole.trim()) {
      setOccurrenceErrorMessage("Informe o nome e a função ou órgão de quem está registrando a ocorrência.");
      setOpenCard("occurrence");
      return;
    }

    if (!occurrenceForm.impact.trim() || !occurrenceForm.description.trim()) {
      setOccurrenceErrorMessage("Preencha o impacto observado e os detalhes da ocorrência.");
      setOpenCard("occurrence");
      return;
    }

    if (occurrenceForm.updateStatus && !occurrenceForm.nextStatus) {
      setOccurrenceErrorMessage("Selecione o novo status da área para registrar a mudança.");
      setOpenCard("occurrence");
      return;
    }

    if (occurrenceForm.updateStatus && occurrenceForm.nextStatus === targetArea.status) {
      setOccurrenceErrorMessage("Escolha um novo status diferente do status atual da área.");
      setOpenCard("occurrence");
      return;
    }

    setIsSavingOccurrence(true);

    const baseDescription = occurrenceForm.description.trim();
    const reviewTimestamp = new Date().toISOString();
    const locationSuffix =
      occurrenceLocation && occurrenceForm.areaId
        ? `\n\nPonto registrado no mapa: ${occurrenceLocation.latitude.toFixed(6)}, ${occurrenceLocation.longitude.toFixed(6)}`
        : "";
    const shouldUpdateStatus =
      occurrenceForm.updateStatus &&
      occurrenceForm.nextStatus &&
      occurrenceForm.nextStatus !== targetArea.status;
    let statusWasUpdated = shouldUpdateStatus;
    const patch = {
      impact: occurrenceForm.impact.trim(),
      description: `${baseDescription}${locationSuffix}\n\nRegistrado por: ${occurrenceForm.reporterName.trim()} — ${occurrenceForm.reporterRole.trim()}`,
      status: shouldUpdateStatus ? occurrenceForm.nextStatus : targetArea.status,
      previousStatus: shouldUpdateStatus ? targetArea.status : null,
      statusUpdated: shouldUpdateStatus,
      lastStatusReviewAt: reviewTimestamp,
      lastStatusChangeReason: shouldUpdateStatus ? occurrenceForm.impact.trim() : targetArea.lastStatusChangeReason,
      lastOccurrenceDescription: shouldUpdateStatus ? `${baseDescription}${locationSuffix}` : targetArea.lastOccurrenceDescription,
    };
    if (hasSupabaseConfig()) {
      let { data: occurrenceResult, error: occurrenceError } = await supabase.rpc(
        "register_occurrence_with_status",
        {
          p_area_id: occurrenceForm.areaId,
          p_impact: patch.impact,
          p_description: patch.description,
          p_latitude: occurrenceLocation?.latitude ?? null,
          p_longitude: occurrenceLocation?.longitude ?? null,
          p_image_url: occurrencePreview ?? null,
          p_update_status: shouldUpdateStatus,
          p_new_status: shouldUpdateStatus ? patch.status : null,
          p_changed_by: null,
        },
      );

      if (occurrenceError && isMissingOccurrenceRpc(occurrenceError)) {
        const { data: insertedOccurrence, error: insertError } = await supabase
          .from("occurrences")
          .insert({
            area_id: occurrenceForm.areaId,
            impact: patch.impact,
            description: patch.description,
            latitude: occurrenceLocation?.latitude ?? null,
            longitude: occurrenceLocation?.longitude ?? null,
            image_url: occurrencePreview ?? null,
            previous_status: shouldUpdateStatus ? targetArea.status : null,
            new_status: shouldUpdateStatus ? patch.status : null,
            status_updated: shouldUpdateStatus,
            created_by: null,
          })
          .select()
          .single();

        occurrenceError = insertError;
        if (!insertError && insertedOccurrence) {
          let updatedArea = targetArea;
          if (shouldUpdateStatus) {
            const { data: updatedRow, error: updateError } = await supabase
              .from("areas")
              .update({
                status: patch.status,
                impact: patch.impact,
                description: patch.description,
                image_url: occurrencePreview ?? targetArea.image,
                last_occurrence_id: insertedOccurrence.id,
                last_status_review_at: reviewTimestamp,
              })
              .eq("id", occurrenceForm.areaId)
              .select()
              .single();
            if (updateError) {
              console.error(updateError);
              statusWasUpdated = false;
            } else {
              updatedArea = updatedRow;
            }
          }
          occurrenceResult = {
            occurrence_id: insertedOccurrence.id,
            area: updatedArea,
            status_changed: statusWasUpdated,
          };
        } else if (insertError && isMissingOccurrencesTable(insertError)) {
          const compatibilityOccurrenceId = createId();
          const occurrenceArchive = [
            targetArea.description,
            `--- Ocorrência registrada em ${new Date(reviewTimestamp).toLocaleString("pt-BR")} ---`,
            patch.description,
          ].filter(Boolean).join("\n\n");
          const { data: updatedRow, error: compatibilityError } = await supabase
            .from("areas")
            .update({
              status: statusWasUpdated ? patch.status : targetArea.status,
              impact: patch.impact,
              description: occurrenceArchive,
              image_url: occurrencePreview ?? targetArea.image,
            })
            .eq("id", occurrenceForm.areaId)
            .select()
            .single();
          occurrenceError = compatibilityError;
          if (!compatibilityError) {
            occurrenceResult = {
              occurrence_id: compatibilityOccurrenceId,
              area: updatedRow,
              status_changed: statusWasUpdated,
              compatibility_mode: true,
            };
          }
        }
      }

      if (occurrenceError) {
        console.error(occurrenceError);
        setDataMode("supabase");
        setDataStatus("Não foi possível salvar a ocorrência e a atualização de status no Supabase.");
        setOccurrenceErrorMessage(`Não foi possível registrar a ocorrência. ${occurrenceError.message ?? "Tente novamente."}`);
        setIsSavingOccurrence(false);
        setOpenCard("occurrence");
        return;
      }

      const updatedAreaRow = occurrenceResult?.area ?? occurrenceResult?.updated_area ?? null;
      const mapped = mapSupabaseAreaToApp(updatedAreaRow) ?? {
        ...targetArea,
        impact: patch.impact,
        description: patch.description,
        status: statusWasUpdated ? patch.status : targetArea.status,
        image: occurrencePreview ?? targetArea.image,
      };

      setDataMode("supabase");
      setDataStatus(
        occurrenceResult?.compatibility_mode
          ? "Ocorrência salva no Supabase e vinculada diretamente ao histórico da área."
          : statusWasUpdated
          ? `Status da área alterado de ${statusUpdateLabel(targetArea.status)} para ${statusUpdateLabel(patch.status)}.`
          : "Ocorrência sincronizada sem alterar o status da área.",
      );
      setOccurrenceRecords((current) => [
        ...current,
        {
          id: occurrenceResult?.occurrence_id ?? createId(),
          area_id: occurrenceForm.areaId,
          impact: patch.impact,
          description: patch.description,
          previous_status: patch.previousStatus,
          new_status: statusWasUpdated ? patch.status : null,
          status_updated: statusWasUpdated,
          created_at: reviewTimestamp,
        },
      ]);
      if (statusWasUpdated) {
        const historyEntry = buildStatusHistoryEntry({
          area: targetArea,
          occurrenceId: occurrenceResult?.occurrence_id ?? createId(),
          previousStatus: targetArea.status,
          newStatus: patch.status,
          impact: patch.impact,
          description: patch.description,
          changedAt: patch.lastStatusReviewAt,
        });
        setStatusHistory((current) => [historyEntry, ...current.filter((item) => item.id !== historyEntry.id)]);
        setStatusChangeNotice({
          areaName: targetArea.name,
          previousStatus: targetArea.status,
          newStatus: patch.status,
          impact: patch.impact,
          changedAt: patch.lastStatusReviewAt,
        });
        setRecentlyUpdatedAreaId(targetArea.id);
      }
      setAreas((current) =>
        current.map((area) =>
          area.id === occurrenceForm.areaId
            ? {
                ...area,
                ...mapped,
                previousStatus: statusWasUpdated ? patch.previousStatus : null,
                statusUpdated: statusWasUpdated,
                lastStatusReviewAt: patch.lastStatusReviewAt,
                lastStatusChangeReason: patch.impact,
                lastOccurrenceDescription: patch.description,
                lastOccurrenceId: occurrenceResult?.occurrence_id ?? mapped.lastOccurrenceId,
              }
            : area,
        ),
      );
      if (statusWasUpdated) {
        setOccurrenceSuccessMessage(`Área ${targetArea.name} atualizada de ${statusUpdateLabel(targetArea.status)} para ${statusUpdateLabel(patch.status)}.`);
      } else {
        setOccurrenceSuccessMessage(occurrenceResult?.compatibility_mode ? "Ocorrência salva e vinculada à área com sucesso." : "Ocorrência registrada com sucesso.");
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
      setOccurrenceRecords((current) => [...current, { id: createId(), area_id: occurrenceForm.areaId }]);
      if (shouldUpdateStatus) {
        const historyEntry = buildStatusHistoryEntry({
          area: targetArea,
          occurrenceId: createId(),
          previousStatus: targetArea.status,
          newStatus: patch.status,
          impact: patch.impact,
          description: patch.description,
          changedAt: patch.lastStatusReviewAt,
        });
        setStatusHistory((current) => [historyEntry, ...current]);
        setStatusChangeNotice({
          areaName: targetArea.name,
          previousStatus: targetArea.status,
          newStatus: patch.status,
          impact: patch.impact,
          changedAt: patch.lastStatusReviewAt,
        });
        setRecentlyUpdatedAreaId(targetArea.id);
      }
      setOccurrenceSuccessMessage("Ocorrência registrada com sucesso.");
    }
    setIsSavingOccurrence(false);
    setActiveAreaId(null);
    setMapFocus(createMapFocus({ ...targetArea, status: patch.status }));
    resetOccurrenceDraft();
    setOpenCard(null);
  }

  return (
    <div className={`app-shell${isMobileViewport && openCard ? " app-shell--mobile-overlay-open" : ""}${isDrawingArea || draftPolygonCoords.length > 0 ? " app-shell--drawing" : ""}`}>
      {isMobileViewport ? <MobileWorkspace
        overlayOpen={Boolean(openCard)}
        activeCard={openCard}
        locationNotice={locationNotice}
        selectedRegion={selectedRegion}
        isLocatingUser={isLocatingUser}
        onLocateUser={locateUser}
        onSearch={searchLocation}
        onGoHome={goToHome}
        onOpenAbout={() => setOpenCard("about-mobile")}
        onOpenArea={() => {
          if (openCard === "area") { resetAreaDraft(); setOpenCard(null); }
          else setOpenCard("area");
        }}
        onOpenOccurrence={() => {
          if (openCard === "occurrence" || openCard === "occurrence-guide") {
            if (openCard === "occurrence") resetOccurrenceDraft();
            setOpenCard(null);
          } else openOccurrenceFlow();
        }}
        onOpenLegend={() => setOpenCard((current) => current === "legend" ? null : "legend")}
        onOpenReports={() => setOpenCard((current) => current === "status" ? null : "status")}
        onOpenFilters={() => setOpenCard("layers")}
      /> : <DesktopWorkspace
        selectedRegion={selectedRegion}
        hasActiveMapAction={Boolean(openCard) || isDrawingArea || draftPolygonCoords.length > 0}
        regionSummary={regionSummary}
        occurrenceCount={regionOccurrenceCount}
        layerFilters={layerFilters}
        onToggleLayer={toggleLayerFilter}
        isLocatingUser={isLocatingUser}
        onLocateUser={locateUser}
        onSearch={searchLocation}
        onGoHome={goToHome}
        onOpenArea={() => setOpenCard("area")}
        onOpenOccurrence={openOccurrenceFlow}
        onOpenLegend={() => setOpenCard("legend")}
        onOpenReports={() => setOpenCard("status")}
      />}
      <main className="map-stage">
        <StatusChangeToast notice={statusChangeNotice} onClose={() => setStatusChangeNotice(null)} />
        {!isMobileViewport && locationNotice ? <div className={`desktop-location-notice${isLocatingUser ? " is-loading" : ""}`} role="status" aria-live="polite">{locationNotice}</div> : null}
        {(isDrawingArea || draftPolygonCoords.length > 0) ? (
          <div className="mobile-drawing-bar">
            <button
              type="button"
              className="mobile-drawing-bar__button"
              onClick={locateUser}
              disabled={isLocatingUser}
            >
              {isLocatingUser ? "Localizando..." : "Minha localização"}
            </button>
            <button
              type="button"
              className="mobile-drawing-bar__button mobile-drawing-bar__button--primary"
              onClick={concludeAreaDrawing}
              disabled={draftPolygonCoords.length < 3}
            >
              Concluir área
            </button>
            <button
              type="button"
              className="mobile-drawing-bar__button"
              onClick={clearAreaDrawing}
            >
              Limpar
            </button>
          </div>
        ) : null}
          <MapContainer
            center={FALLBACK_CENTER}
            zoom={10}
          scrollWheelZoom={true}
          dragging={true}
          touchZoom={true}
          doubleClickZoom={true}
          boxZoom={true}
          keyboard={true}
          tap={true}
          maxZoom={MAX_MAP_ZOOM}
          className="leaflet-map"
        >
          <MapViewportSync />
          {activeBaseMap === "satellite" ? (
            <TileLayer attribution={SATELLITE_TILES.attribution} url={SATELLITE_TILES.url} maxNativeZoom={17} maxZoom={MAX_MAP_ZOOM} keepBuffer={isMobileViewport ? 1 : 2} updateWhenZooming={false} detectRetina={false} eventHandlers={{ load: () => setBaseMapReady(true) }} />
          ) : (
            <TileLayer attribution={STREET_TILES.attribution} url={STREET_TILES.url} maxNativeZoom={19} maxZoom={MAX_MAP_ZOOM} keepBuffer={isMobileViewport ? 1 : 2} updateWhenZooming={false} detectRetina={false} eventHandlers={{ load: () => setBaseMapReady(true) }} />
          )}
          <MapInteractionLock locked={Boolean(activeAreaId)} />
          <MapFocusController focus={mapFocus} />
          {boundaryData ? <BoundaryLayer geojson={boundaryData} /> : null}
          <UserLocationLayer location={userLocation} />
          <SearchResultLayer result={searchedLocation} />
          <MapClickHandler
            drawingEnabled={isDrawingArea}
            onMapBlankClick={() => {
              setActiveAreaId(null);
              setHoveredAreaId(null);
            }}
            onDrawPoint={(latlng) => {
              setDraftPolygonCoords((current) => {
                const next = [...current, [latlng.lat, latlng.lng]];
                setAreaForm((form) => ({ ...form, polygonCoords: next }));
                return next;
              });
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
          <AreaLayer
            areas={visibleAreas}
            occurrenceRecords={visibleOccurrenceRecords}
            statusHistory={statusHistory}
            recentlyUpdatedAreaId={recentlyUpdatedAreaId}
            drawingEnabled={isDrawingArea}
            hoveredAreaId={hoveredAreaId}
            activeAreaId={activeAreaId}
            onReturnToReports={detailOrigin === "status" ? () => {
              setActiveAreaId(null);
              setHoveredAreaId(null);
              setDetailOrigin(null);
              setOpenCard("status");
            } : null}
            onHoverArea={(areaId) => {
              setHoveredAreaId(areaId);
              loadAreaImage(areaId);
            }}
            onLeaveArea={(areaId) => {
              setHoveredAreaId((current) => (current === areaId ? null : current));
            }}
            onToggleArea={(areaId) => {
              setDetailOrigin(null);
              setActiveAreaId(areaId);
              setHoveredAreaId(null);
              setOccurrenceForm((current) => ({ ...current, areaId }));
              loadAreaImage(areaId);
            }}
            onCloseArea={(areaId) => {
              setActiveAreaId((current) => (current === areaId ? null : current));
              setHoveredAreaId((current) => (current === areaId ? null : current));
            }}
            onAreaPointSelect={(area, point) => {
              setActiveAreaId(area.id);
              setHoveredAreaId(area.id);
              setOccurrenceForm((current) => ({ ...current, areaId: area.id }));
              setOccurrenceLocation(point);
              setOpenCard("occurrence");
            }}
          />
          {showMapLabels ? <Pane name="labels-pane" style={{ zIndex: 450, pointerEvents: "none" }}>
            <TileLayer attribution={LABEL_TILES.attribution} url={LABEL_TILES.url} maxNativeZoom={18} maxZoom={MAX_MAP_ZOOM} />
          </Pane> : null}
        </MapContainer>
        <BottomSheet
          isOpen={openCard === "about-mobile"}
          title="Sobre o projeto"
          onClose={() => setOpenCard(null)}
        >
          <MobileAboutContent />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "notifications"}
          title="Notificações"
          onClose={() => setOpenCard(null)}
        >
          <NotificationContent summary={notificationSummary} />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "help"}
          title="Ajuda rápida"
          onClose={closeHelp}
        >
          <HelpGuide />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "occurrence-guide"}
          title="Registrar ocorrência"
          onClose={() => setOpenCard(null)}
        >
          <OccurrenceGuide
            areas={areas}
            onSelectArea={(area) => {
              setActiveAreaId(area.id);
              setHoveredAreaId(null);
              setOccurrenceForm(emptyOccurrenceForm(area.id));
              setOccurrenceLocation(null);
              setMapFocus(createMapFocus(area));
              loadAreaImage(area.id);
              setOpenCard("occurrence");
            }}
            onCreateArea={() => setOpenCard("area")}
            onCancel={() => setOpenCard(null)}
          />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "legend"}
          title="Legenda"
          onClose={() => setOpenCard(null)}
        >
          <LegendContent />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "status"}
          title="Relatórios ambientais"
          onClose={() => setOpenCard(null)}
        >
          <StatusContent areas={regionAreas} onSelectArea={openAreaFromStatus} />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "layers"}
          title="Filtros do mapa"
          onClose={() => setOpenCard(null)}
        >
          <LayerSheet
            activeBaseMap={activeBaseMap}
            onChangeBaseMap={setActiveBaseMap}
            layerFilters={layerFilters}
            onToggleLayer={toggleLayerFilter}
            regionSummary={regionSummary}
          />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "area"}
          title="Nova área"
          onClose={() => { resetAreaDraft(); setOpenCard(null); }}
          large
        >
          <AreaFormPanel
            areaForm={areaForm}
            setAreaForm={setAreaForm}
            areaPreview={areaPreview}
            setAreaPreview={setAreaPreview}
            isDrawingArea={isDrawingArea}
            draftPolygonCoords={draftPolygonCoords}
            onStartAreaDrawing={startAreaDrawing}
            onConcludeAreaDrawing={concludeAreaDrawing}
            onClearAreaDrawing={clearAreaDrawing}
            onLocateAndStartDrawing={locateAndStartDrawing}
            onSearchAndStartDrawing={searchAndStartAreaDrawing}
            isLocatingUser={isLocatingUser}
            hasUserLocation={Boolean(userLocation)}
            onSubmitArea={handleAreaSubmit}
            isSavingArea={isSavingArea}
            areaSuccessMessage={areaSuccessMessage}
            areaErrorMessage={areaErrorMessage}
            onCancelArea={() => { resetAreaDraft(); setOpenCard(null); }}
            mobile
          />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "area-created" && Boolean(createdAreaForOccurrence)}
          title="Área cadastrada"
          onClose={() => { setCreatedAreaForOccurrence(null); setOpenCard(null); }}
        >
          <AreaCreatedNextStep
            area={createdAreaForOccurrence}
            onRegisterOccurrence={() => {
              setActiveAreaId(null);
              setOccurrenceForm(emptyOccurrenceForm(createdAreaForOccurrence.id));
              setCreatedAreaForOccurrence(null);
              setOpenCard("occurrence");
            }}
            onFinish={() => { setCreatedAreaForOccurrence(null); setOpenCard(null); }}
          />
        </BottomSheet>
        <BottomSheet
          isOpen={openCard === "occurrence"}
          title="Registrar ocorrência"
          onClose={() => { resetOccurrenceDraft(); setOpenCard(null); }}
          large
        >
          <OccurrenceFormPanel
            areas={areas}
            occurrenceForm={occurrenceForm}
            setOccurrenceForm={setOccurrenceForm}
            occurrencePreview={occurrencePreview}
            setOccurrencePreview={setOccurrencePreview}
            onSubmitOccurrence={handleOccurrenceSubmit}
            isSavingOccurrence={isSavingOccurrence}
            occurrenceSuccessMessage={occurrenceSuccessMessage}
            occurrenceErrorMessage={occurrenceErrorMessage}
            onCancelOccurrence={() => { resetOccurrenceDraft(); setOpenCard(null); }}
            occurrenceLocation={occurrenceLocation}
            mobile
          />
        </BottomSheet>
      </main>
    </div>
  );
}

function StatusChangeToast({ notice, onClose }) {
  if (!notice) return null;
  return (
    <aside className={`status-change-toast status-change-toast--${notice.newStatus}`} role="status" aria-live="polite">
      <div>
        <span className="status-change-toast__kicker">Status atualizado</span>
        <strong>{notice.areaName}</strong>
        <p>
          {statusUpdateLabel(notice.previousStatus)} {"\u2192"} {statusUpdateLabel(notice.newStatus)}
        </p>
        <small>{notice.impact}</small>
      </div>
      <button type="button" onClick={onClose} aria-label="Fechar aviso de status">×</button>
    </aside>
  );
}

function AreaPolygonFeature({ area, drawingEnabled, isHovered, isActive, onHover, onLeave, onAreaPointSelect }) {
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
    </>
  );
}

function AreaFeature({ area, history, occurrences, isRecentlyUpdated, drawingEnabled, isHovered, isActive, onHover, onLeave, onToggle, onClose, onAreaPointSelect, onReturnToReports, showPolygon = true }) {
  return (
    <>
      {showPolygon ? <AreaPolygonFeature
        area={area}
        drawingEnabled={drawingEnabled}
        isHovered={isHovered}
        isActive={isActive}
        onHover={onHover}
        onLeave={onLeave}
        onAreaPointSelect={onAreaPointSelect}
      /> : null}
      {!drawingEnabled ? (
        <Marker
          position={[area.latitude, area.longitude]}
          icon={getMarkerIcon(area.status, isRecentlyUpdated)}
          eventHandlers={{
            click: onToggle,
          }}
        />
      ) : null}
      {isActive ? (
        <Popup
          closeButton={false}
          position={[area.latitude, area.longitude]}
          keepInView
          autoPan
          autoPanPaddingTopLeft={L.point(36, 190)}
          autoPanPaddingBottomRight={L.point(150, 130)}
          eventHandlers={{ remove: onClose }}
        >
          <DetailCard area={area} history={history} occurrences={occurrences} onClose={onClose} onReturnToReports={onReturnToReports} />
        </Popup>
      ) : null}
    </>
  );
}

function AreaLayer(props) {
  const {
    areas,
    occurrenceRecords = [],
    statusHistory = [],
    recentlyUpdatedAreaId,
    drawingEnabled,
    hoveredAreaId,
    activeAreaId,
    onHoverArea,
    onLeaveArea,
    onToggleArea,
    onCloseArea,
    onAreaPointSelect,
    onReturnToReports,
  } = props;
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [hasCenteredOnAreas, setHasCenteredOnAreas] = useState(false);
  const clusters = useMemo(() => createAreaClusters(areas, zoom), [areas, zoom]);

  useEffect(() => {
    const syncZoom = () => setZoom(map.getZoom());
    map.on("zoomend", syncZoom);
    return () => map.off("zoomend", syncZoom);
  }, [map]);

  useEffect(() => {
    if (hasCenteredOnAreas || !areas.length) return;
    const densestCluster = createAreaClusters(areas, 10)
      .sort((left, right) => right.areas.length - left.areas.length)[0];
    if (!densestCluster) return;
    setHasCenteredOnAreas(true);
    map.setView(densestCluster.center, 10, { animate: false });
  }, [areas, hasCenteredOnAreas, map]);

  if (drawingEnabled) {
    return areas.map((area) => (
      <AreaFeature
        key={area.id}
        area={area}
        history={getAreaStatusHistory(statusHistory, area.id)}
        occurrences={getAreaOccurrences(occurrenceRecords, area.id)}
        isRecentlyUpdated={recentlyUpdatedAreaId === area.id || isRecentStatusChange(area)}
        drawingEnabled={drawingEnabled}
        isHovered={hoveredAreaId === area.id}
        isActive={activeAreaId === area.id}
        onHover={() => onHoverArea(area.id)}
        onLeave={() => onLeaveArea(area.id)}
        onToggle={() => onToggleArea(area.id)}
        onClose={() => onCloseArea(area.id)}
        onAreaPointSelect={(point) => onAreaPointSelect(area, point)}
        onReturnToReports={onReturnToReports}
      />
    ));
  }

  return <>
    {areas.map((area) => (
      <AreaPolygonFeature
        key={`polygon-${area.id}`}
        area={area}
        drawingEnabled={drawingEnabled}
        isHovered={hoveredAreaId === area.id}
        isActive={activeAreaId === area.id}
        onHover={() => onHoverArea(area.id)}
        onLeave={() => onLeaveArea(area.id)}
        onAreaPointSelect={(point) => onAreaPointSelect(area, point)}
      />
    ))}
    {clusters.map((cluster) => {
    if (cluster.areas.length === 1) {
      const area = cluster.areas[0];
      return (
        <AreaFeature
          key={area.id}
          area={area}
          history={getAreaStatusHistory(statusHistory, area.id)}
          occurrences={getAreaOccurrences(occurrenceRecords, area.id)}
          isRecentlyUpdated={recentlyUpdatedAreaId === area.id || isRecentStatusChange(area)}
          drawingEnabled={drawingEnabled}
          isHovered={hoveredAreaId === area.id}
          isActive={activeAreaId === area.id}
          onHover={() => onHoverArea(area.id)}
          onLeave={() => onLeaveArea(area.id)}
          onToggle={() => onToggleArea(area.id)}
          onClose={() => onCloseArea(area.id)}
          onAreaPointSelect={(point) => onAreaPointSelect(area, point)}
          onReturnToReports={onReturnToReports}
          showPolygon={false}
        />
      );
    }

    return (
      <Marker
        key={cluster.id}
        position={cluster.center}
        icon={getClusterIcon(cluster.areas)}
        eventHandlers={{
          click: () => {
            map.setView(cluster.center, Math.min(map.getZoom() + 3, LOCAL_ZOOM), { animate: true });
          },
        }}
      >
        <Tooltip direction="top" offset={[0, -14]} opacity={1} className="environment-tooltip">
          <ClusterCard areas={cluster.areas} />
        </Tooltip>
      </Marker>
    );
    })}
  </>;
}

function MobileWorkspace({
  overlayOpen,
  activeCard,
  locationNotice,
  selectedRegion,
  isLocatingUser,
  onLocateUser,
  onSearch,
  onGoHome,
  onOpenAbout,
  onOpenArea,
  onOpenOccurrence,
  onOpenLegend,
  onOpenReports,
  onOpenFilters,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [welcomeVisible, setWelcomeVisible] = useState(true);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  return (
    <div className={`mobile-workspace${overlayOpen ? " mobile-workspace--overlay-open" : ""}`}>
      <header className="mobile-gis-header">
        <button type="button" className="mobile-gis-brand" onClick={() => { setWelcomeVisible(true); onGoHome(); }} aria-label="Voltar ao início" title="Voltar ao início">
          <span className="mobile-gis-brand__mark"><LeafIcon /></span>
          <span><strong>MAPA DE ATENÇÃO AMBIENTAL</strong><small>MAPEIE. PROTEJA. PRESERVE.</small></span>
        </button>
        <button type="button" className="mobile-about-button" onClick={onOpenAbout} aria-label="Sobre o projeto"><InfoIcon /></button>
        <form className="mobile-gis-search" onSubmit={(event) => { event.preventDefault(); onSearch(searchQuery); }}>
          <SearchIcon />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar localidade..." aria-label="Buscar localidade" />
          <button type="submit" aria-label="Buscar localidade" title="Buscar localidade"><SearchIcon /></button>
        </form>
      </header>

      <div className="mobile-region-bar">
        <button type="button" className="mobile-region-button" onClick={onLocateUser}><MapPinIcon /><span>{selectedRegion.name}</span><ChevronDownIcon /></button>
        <button type="button" className="mobile-location-button" onClick={onLocateUser} disabled={isLocatingUser}><TargetIcon /><span>{isLocatingUser ? "Localizando..." : "Minha localização"}</span></button>
      </div>

      {locationNotice ? <div className={`mobile-location-notice${isLocatingUser ? " is-loading" : ""}`} role="status" aria-live="polite">{locationNotice}</div> : null}

      <div className="mobile-map-tools" aria-label="Controles do mapa">
        <button type="button" onClick={onLocateUser} aria-label="Minha posição"><TargetIcon /></button>
        <button type="button" onClick={toggleFullscreen} aria-label="Tela cheia"><MaximizeIcon /></button>
        <button type="button" onClick={onOpenFilters} aria-label="Filtros do mapa"><LayersIcon /></button>
      </div>

      {welcomeVisible ? <section className="mobile-welcome-panel">
        <button type="button" className="mobile-welcome-panel__close" onClick={() => setWelcomeVisible(false)} aria-label="Fechar bloco informativo"><CloseIcon /></button>
        <span>Bem-vindo ao</span>
        <h2>Mapa de Atenção Ambiental</h2>
        <p>Explore, registre e monitore áreas ambientais em qualquer lugar do Brasil.</p>
        <div className="mobile-welcome-panel__grid">
          <FeatureMiniCard icon={<MapPinIcon />} title="Mapeamento" text="Áreas em tempo real" />
          <FeatureMiniCard icon={<StatusIcon />} title="Monitoramento" text="Acompanhamento contínuo" />
          <FeatureMiniCard icon={<AlertIcon />} title="Ocorrências" text="Registros de impactos" />
          <FeatureMiniCard icon={<LeafIcon />} title="Preservação" text="Ações e conservação" />
        </div>
      </section> : null}

      <nav className="mobile-bottom-nav" aria-label="Ações principais">
        <MobileNavAction icon={<AreaIcon />} label="Nova área" onClick={onOpenArea} active={activeCard === "area"} />
        <MobileNavAction icon={<AlertIcon />} label="Ocorrência" onClick={onOpenOccurrence} active={activeCard === "occurrence" || activeCard === "occurrence-guide"} />
        <MobileNavAction icon={<LegendIcon />} label="Legenda" onClick={onOpenLegend} active={activeCard === "legend"} />
        <MobileNavAction icon={<StatusIcon />} label="Relatórios" onClick={onOpenReports} active={activeCard === "status"} />
      </nav>
    </div>
  );
}

function MobileNavAction({ icon, label, onClick, active = false }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={onClick} aria-pressed={active}>{icon}<span>{label}</span></button>;
}

function MaximizeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>;
}

function MobileAboutContent() {
  return <div className="mobile-about-content">
    <strong>Mapa de Atenção Ambiental</strong>
    <p>Plataforma colaborativa para mapear, registrar e monitorar áreas ambientais e ocorrências em diferentes localidades.</p>
    <ul>
      <li>Cadastro e acompanhamento de áreas ambientais</li>
      <li>Registro de impactos e ocorrências</li>
      <li>Visualização por filtros e situação ambiental</li>
    </ul>
    <small>Projeto ligado à II HACKEPT — Maratona de Inovação dos Centros Educa Mais e EJATEC 2026.</small>
  </div>;
}

function DesktopWorkspace({
  selectedRegion,
  hasActiveMapAction,
  regionSummary,
  occurrenceCount,
  layerFilters,
  onToggleLayer,
  isLocatingUser,
  onLocateUser,
  onSearch,
  onGoHome,
  onOpenArea,
  onOpenOccurrence,
  onOpenLegend,
  onOpenReports,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const [welcomeMinimized, setWelcomeMinimized] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);
  const [layersExpanded, setLayersExpanded] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const preserved = regionSummary.find((item) => item.key === "preservado")?.value ?? 0;
  const attention = regionSummary.find((item) => item.key === "atencao")?.value ?? 0;
  const critical = regionSummary.find((item) => item.key === "critico")?.value ?? 0;
  const layerOptions = [
    { key: "preservado", label: "Áreas preservadas", count: preserved, icon: <span className="legend-swatch legend-swatch--green" />, tone: "green" },
    { key: "atencao", label: "Áreas em atenção", count: regionSummary.find((item) => item.key === "atencao")?.value ?? 0, icon: <span className="legend-swatch legend-swatch--yellow" />, tone: "yellow" },
    { key: "critico", label: "Áreas críticas", count: regionSummary.find((item) => item.key === "critico")?.value ?? 0, icon: <span className="legend-swatch legend-swatch--red" />, tone: "red" },
  ];

  useEffect(() => {
    if (!hasActiveMapAction) return;
    setWelcomeVisible(false);
    setLayersExpanded(false);
    setSummaryExpanded(false);
    setAboutExpanded(false);
  }, [hasActiveMapAction]);

  return (
    <div className="desktop-workspace">
      <header className="gis-header">
        <button type="button" className="gis-brand" onClick={() => { setWelcomeVisible(true); setWelcomeMinimized(false); setLegendVisible(true); setAboutExpanded(false); setLayersExpanded(true); setSummaryExpanded(true); onGoHome(); }} aria-label="Voltar ao início" title="Voltar ao início">
          <span className="gis-brand__mark"><LeafIcon /></span>
          <span><strong>MAPA DE ATENÇÃO AMBIENTAL</strong><small>MAPEIE. PROTEJA. PRESERVE.</small></span>
        </button>
        <form className="gis-search" onSubmit={(event) => { event.preventDefault(); onSearch(searchQuery); }}>
          <SearchIcon />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Digite um local, cidade, estado ou coordenadas..." aria-label="Buscar local" />
          <button type="submit" aria-label="Buscar" title="Buscar"><TargetIcon /><span>Buscar</span></button>
        </form>
        <button type="button" className="gis-about" onClick={() => setAboutExpanded((current) => !current)} aria-expanded={aboutExpanded}><InfoIcon /> Sobre o projeto</button>
      </header>

      {welcomeVisible ? welcomeMinimized ? <button type="button" className="welcome-panel-minimized" onClick={() => setWelcomeMinimized(false)} aria-label="Expandir Mapa de Atenção Ambiental" title="Expandir Mapa de Atenção Ambiental">
        <LeafIcon />
        <span><strong>Mapa de Atenção Ambiental</strong><small>Mostrar informações</small></span>
        <ChevronDownIcon />
      </button> : <section className="welcome-panel">
        <div className="welcome-panel__controls">
          <button type="button" className="welcome-panel__minimize" onClick={() => setWelcomeMinimized(true)} aria-label="Minimizar Mapa de Atenção Ambiental" title="Minimizar">−</button>
          <button type="button" className="welcome-panel__close" onClick={() => setWelcomeVisible(false)} aria-label="Fechar mensagem de boas-vindas" title="Fechar"><CloseIcon /></button>
        </div>
        <span>Bem-vindo ao</span>
        <h1>Mapa de Atenção Ambiental</h1>
        <p>Explore, registre e monitore áreas ambientais em qualquer lugar do Brasil.</p>
        <div className="welcome-grid">
          <FeatureMiniCard icon={<MapPinIcon />} title="Mapeamento" text="Áreas em tempo real" />
          <FeatureMiniCard icon={<StatusIcon />} title="Monitoramento" text="Acompanhamento contínuo" />
          <FeatureMiniCard icon={<AlertIcon />} title="Ocorrências" text="Registros de impactos" />
          <FeatureMiniCard icon={<LeafIcon />} title="Preservação" text="Ações e conservação" />
        </div>
      </section> : null}

      <div className="gis-region-controls">
        <button type="button" className="gis-region-pill" onClick={onLocateUser}><MapPinIcon /><span>{selectedRegion.name}</span><span className="gis-chevron"><ChevronDownIcon /></span></button>
        <button type="button" className="gis-location-pill" onClick={onLocateUser} disabled={isLocatingUser}><TargetIcon />{isLocatingUser ? "Localizando..." : "Minha localização"}</button>
      </div>

      <aside className="gis-right-rail">
        {aboutExpanded ? <section className="gis-white-panel about-project-panel">
          <div className="about-project-panel__header">
            <strong>Sobre o projeto</strong>
            <button type="button" onClick={() => setAboutExpanded(false)} aria-label="Fechar Sobre o projeto" title="Fechar"><CloseIcon /></button>
          </div>
          <div className="about-project-content">
            <strong>Mapa de Atenção Ambiental</strong>
            <p>Plataforma colaborativa para mapear, registrar e monitorar áreas ambientais e ocorrências em diferentes localidades.</p>
            <ul>
              <li>Cadastro e acompanhamento de áreas ambientais</li>
              <li>Registro de impactos e ocorrências</li>
              <li>Visualização por filtros e situação ambiental</li>
            </ul>
            <small>Projeto ligado à II HACKEPT — Maratona de Inovação dos Centros Educa Mais e EJATEC 2026.</small>
          </div>
        </section> : null}
        <section className={`gis-white-panel layers-overview${layersExpanded ? " is-expanded" : " is-collapsed"}`}>
          <button type="button" className="gis-panel-title" onClick={() => setLayersExpanded((current) => !current)} aria-expanded={layersExpanded}><LayersIcon /><strong>Filtros do mapa</strong><span className="layers-chevron">⌃</span></button>
          {layersExpanded ? <div className="gis-layer-list">
            {layerOptions.map((option) => (
              <button type="button" key={option.key} onClick={() => onToggleLayer(option.key)} aria-pressed={layerFilters[option.key]}><span className={`filter-icon filter-icon--${option.tone}`}>{option.icon}</span><span>{option.label}</span><strong className="filter-count" aria-label={`${option.count} áreas`}>{option.count}</strong><i className={`gis-switch${layerFilters[option.key] ? " is-on" : ""}`} /></button>
            ))}
          </div> : null}
        </section>
        <section className={`gis-white-panel summary-overview${summaryExpanded ? " is-expanded" : " is-collapsed"}`}>
          <button type="button" className="gis-panel-title summary-panel-title" onClick={() => setSummaryExpanded((current) => !current)} aria-expanded={summaryExpanded}><StatusIcon /><strong>Resumo geral</strong><span className="summary-chevron">⌃</span></button>
          {summaryExpanded ? <div className="summary-overview__content">
            <SummaryRow tone="green" icon={<LeafIcon />} label="Áreas preservadas" value={preserved} />
            <SummaryRow tone="yellow" icon={<AlertIcon />} label="Áreas de atenção" value={attention} />
            <SummaryRow tone="red" icon={<FlameIcon />} label="Áreas críticas" value={critical} />
            <SummaryRow tone="blue" icon={<ClipboardIcon />} label="Ocorrências registradas" value={occurrenceCount} />
          </div> : null}
        </section>
      </aside>

      {legendVisible ? <section className="gis-legend" aria-label="Legenda do mapa">
        <strong>LEGENDA</strong>
        <span><LeafIcon /> Área preservada</span>
        <span><AlertIcon /> Área de atenção</span>
        <span><FlameIcon /> Ocorrência registrada</span>
        <span><i className="boundary-symbol" /> Limite territorial</span>
        <button type="button" className="gis-legend__close" onClick={() => setLegendVisible(false)} aria-label="Fechar legenda" title="Fechar legenda"><CloseIcon /></button>
      </section> : null}

      <nav className="gis-primary-actions" aria-label="Ações principais">
        <DesktopAction tone="green" icon={<AreaIcon />} title="Nova área" text="Registrar área" onClick={onOpenArea} />
        <DesktopAction tone="blue" icon={<AlertIcon />} title="Ocorrência" text="Registrar impacto" onClick={onOpenOccurrence} />
        <DesktopAction tone="purple" icon={<LegendIcon />} title="Legenda" text="Consultar símbolos" onClick={() => { setLegendVisible(true); onOpenLegend(); }} />
        <DesktopAction tone="teal" icon={<StatusIcon />} title="Relatórios" text="Ver análises" onClick={onOpenReports} />
      </nav>

    </div>
  );
}

function FeatureMiniCard({ icon, title, text }) {
  return <article>{icon}<span><strong>{title}</strong><small>{text}</small></span></article>;
}

function SummaryRow({ tone, icon, label, value }) {
  return <div className={`summary-row summary-row--${tone}`}>{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function DesktopAction({ tone, icon, title, text, onClick }) {
  return <button type="button" className={`desktop-action desktop-action--${tone}`} onClick={onClick}>{icon}<span><strong>{title}</strong><small>{text}</small></span></button>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function TargetIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
}

function InfoIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>;
}

function Sidebar(props) {
  const {
    isMobileViewport,
    selectedRegion,
    regionSummary,
    hasRegionData,
    isRegionPanelOpen,
    onToggleRegionPanel,
    onUseCurrentLocation,
    isLocatingUser,
    notificationSummary,
    onOpenNotifications,
  } = props;

  return (
    <aside className="sidebar sidebar--mobile">
      <div className="sidebar__panel sidebar__panel--mobile">
        <CompactHeader
          mobile={isMobileViewport}
          selectedRegion={selectedRegion}
          summary={regionSummary}
          hasRegionData={hasRegionData}
          expanded={isRegionPanelOpen}
          onToggle={onToggleRegionPanel}
          onUseCurrentLocation={onUseCurrentLocation}
          isLocatingUser={isLocatingUser}
          notificationSummary={notificationSummary}
          onOpenNotifications={onOpenNotifications}
        />
      </div>
    </aside>
  );
}

function CompactHeader({
  selectedRegion,
  summary,
  hasRegionData,
  expanded,
  onToggle,
  onUseCurrentLocation,
  isLocatingUser,
  notificationSummary,
  onOpenNotifications,
}) {
  return (
    <div className={`region-header${expanded ? " is-expanded" : ""}`}>
      <header className="sidebar__header sidebar__header--mobile">
        <span className="compact-header__logo" aria-hidden="true">
          <LeafIcon />
        </span>
        <div className="compact-header__main">
          <span className="platform-brand">
            <strong>MAPA DE ATENÇÃO AMBIENTAL</strong>
          </span>
          <button
            type="button"
            className="region-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls="region-panel"
          >
            <span>Região: {selectedRegion.name}</span>
            <span className="region-toggle__chevron" aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="mobile-notification" aria-label="Abrir notificações" onClick={onOpenNotifications}>
          <BellIcon />
          {notificationSummary.total > 0 ? (
            <span className="mobile-notification__count" aria-label={`${notificationSummary.total} notificações novas`}>
              {notificationSummary.total > 99 ? "99+" : notificationSummary.total}
            </span>
          ) : null}
        </button>
      </header>

      {expanded ? (
        <section className="region-panel" id="region-panel">
          <div className="region-panel__selected">
            <span className="region-panel__pin" aria-hidden="true">
              <MapPinIcon />
            </span>
            <div>
              <span>Você está visualizando</span>
              <strong>{selectedRegion.name}</strong>
            </div>
          </div>

          <div className="region-panel__divider" />

          <div className="region-panel__section-title">Situação das áreas cadastradas</div>
          <p className="region-panel__explanation">
            Estes números mostram as áreas cadastradas nesta região, separadas pelo status atual.
          </p>
          {!hasRegionData ? (
            <div className="region-empty-state">Ainda não há áreas monitoradas nesta região</div>
          ) : null}
          <div className="region-summary-grid">
            {summary.map((item) => (
              <article key={item.key} className={`region-summary-card region-summary-card--${item.tone}`}>
                <span className="region-summary-card__icon" aria-hidden="true">{item.icon}</span>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
                {item.detail ? <small>{item.detail}</small> : null}
                {typeof item.percentage === "number" ? (
                  <span className="region-summary-card__progress" aria-label={`${item.percentage}% do total`}>
                    <span style={{ width: `${item.percentage}%` }} />
                  </span>
                ) : null}
              </article>
            ))}
          </div>
          <button type="button" className="region-location-action" onClick={onUseCurrentLocation} disabled={isLocatingUser}>
            <span aria-hidden="true"><LocationIcon /></span>
            <span>
              <strong>{isLocatingUser ? "Buscando localização..." : "Usar minha localização atual"}</strong>
              <small>Centralizar mapa na sua posição</small>
            </span>
            <span className="region-location-action__arrow" aria-hidden="true">›</span>
          </button>
        </section>
      ) : null}
    </div>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 5.2-8 12-8 12S4 15.2 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 13h4l-3 5h12l-3-5h4L12 3Z" />
      <path d="M12 18v3" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c4 0 7-2.8 7-6.8 0-2.7-1.6-4.8-3.6-6.8-.6 2-1.8 3-3.1 3.4.3-3.5-1.3-6.1-4.1-8.8.1 3.7-3.2 5.8-3.2 9.6C5 18.4 8 22 12 22Z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6l1 2h3v15H5V6h3l1-2Z" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function createRegionSummary(areas, occurrenceCount) {
  const total = areas.length;
  const countByStatus = (status) => areas.filter((area) => normalizeAreaStatus(area.status) === status).length;
  const percentage = (value) => (total ? `${Math.round((value / total) * 100)}%` : "0%");
  const preserved = countByStatus("preservado");
  const attention = countByStatus("atencao");
  const critical = countByStatus("critico");

  return [
    { key: "total", tone: "green", icon: <LeafIcon />, value: total, label: "Monitoradas", detail: "Total de áreas" },
    { key: "preservado", tone: "green", icon: <TreeIcon />, value: preserved, label: "Preservadas", detail: percentage(preserved), percentage: total ? Math.round((preserved / total) * 100) : 0 },
    { key: "atencao", tone: "yellow", icon: "!", value: attention, label: "Em atenção", detail: percentage(attention), percentage: total ? Math.round((attention / total) * 100) : 0 },
    { key: "critico", tone: "red", icon: <FlameIcon />, value: critical, label: "Críticas", detail: percentage(critical), percentage: total ? Math.round((critical / total) * 100) : 0 },
    { key: "occurrences", tone: "blue", icon: <ClipboardIcon />, value: occurrenceCount, label: "Ocorrências", detail: "Registradas" },
  ];
}

function AreaFormPanel(props) {
  const { areaForm, setAreaForm, areaPreview, setAreaPreview, isDrawingArea, draftPolygonCoords, onStartAreaDrawing, onConcludeAreaDrawing, onClearAreaDrawing, onLocateAndStartDrawing, onSearchAndStartDrawing, isLocatingUser, hasUserLocation, onSubmitArea, isSavingArea, areaSuccessMessage, areaErrorMessage, onCancelArea, mobile = false } = props;
  const areaReady = areaForm.polygonCoords.length >= 3 || draftPolygonCoords.length >= 3;
  const [areaLocationQuery, setAreaLocationQuery] = useState("");
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);

  async function handleAreaLocationSearch() {
    if (!areaLocationQuery.trim() || isSearchingLocation) return;
    setIsSearchingLocation(true);
    try {
      await onSearchAndStartDrawing(areaLocationQuery);
    } finally {
      setIsSearchingLocation(false);
    }
  }

  return (
    <form className="dark-form" onSubmit={onSubmitArea}>
      <div className="dark-form__scroll">
      <div className="form-section-heading">
        <strong>Identificação do responsável</strong>
        <small>Informe quem está realizando este cadastro.</small>
      </div>
      {areaErrorMessage ? <div className="form-feedback form-feedback--error" role="alert">{areaErrorMessage}</div> : null}
      {areaSuccessMessage ? <div className="form-feedback form-feedback--success" role="status">{areaSuccessMessage}</div> : null}
      <div className="field-row">
        <Field label="Nome do responsável"><input required autoComplete="name" value={areaForm.reporterName} onChange={(event) => setAreaForm((current) => ({ ...current, reporterName: event.target.value }))} placeholder="Nome completo" /></Field>
        <Field label="Função ou órgão"><ResponsibleRoleSelect required value={areaForm.reporterRole} onChange={(value) => setAreaForm((current) => ({ ...current, reporterRole: value }))} /></Field>
      </div>
      <Field label="Nome da área"><input required value={areaForm.name} onChange={(event) => setAreaForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Nascente do Riacho Fundo" /></Field>
      <Field label="Categoria">
        <CategoriaSelect
          value={areaForm.category}
          onChange={(value) => setAreaForm((current) => ({ ...current, category: value }))}
          required
        />
      </Field>
      <Field label="Status"><select required value={areaForm.status} onChange={(event) => setAreaForm((current) => ({ ...current, status: event.target.value }))}><option value="preservado">Preservado</option><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></Field>
      <Field label="Condição ou impacto observado"><input required value={areaForm.impact} onChange={(event) => setAreaForm((current) => ({ ...current, impact: event.target.value }))} placeholder={areaStatusObservationPlaceholder(areaForm.status)} /></Field>
      <Field label="Descrição"><textarea required rows="4" value={areaForm.description} onChange={(event) => setAreaForm((current) => ({ ...current, description: event.target.value }))} placeholder="Descreva rapidamente a situação observada." /></Field>
      <section className={`demarcation-panel${mobile ? " demarcation-panel--mobile" : ""}`}>
        <div className="demarcation-panel__header">
          <div className="demarcation-panel__intro">
            <h3>Demarque a área</h3>
            {mobile ? <p>Marque os limites direto no mapa e volte para salvar.</p> : null}
          </div>
        </div>

        <div className="area-location-search">
          <label htmlFor="area-location-query">Buscar a região da área</label>
          <div><SearchIcon /><input id="area-location-query" value={areaLocationQuery} onChange={(event) => setAreaLocationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleAreaLocationSearch(); } }} placeholder="Ex.: Duque Bacelar, MA ou coordenadas" /><button type="button" onClick={handleAreaLocationSearch} disabled={!areaLocationQuery.trim() || isSearchingLocation}>{isSearchingLocation ? "Buscando..." : "Buscar e demarcar"}</button></div>
          <small>O mapa será centralizado na região encontrada para você marcar os limites.</small>
        </div>

        <button
          type="button"
          className="location-demarcation-action"
          onClick={onLocateAndStartDrawing}
          disabled={isLocatingUser}
        >
          <span aria-hidden="true"><LocationIcon /></span>
          <span>
            <strong>{isLocatingUser ? "Buscando sua localização..." : "Usar minha localização e demarcar"}</strong>
            <small>{hasUserLocation ? "Localização encontrada; toque para centralizar novamente." : "Centraliza o mapa e mostra onde você está."}</small>
          </span>
        </button>

        <button
          type="button"
          className={`btn btn--green btn--primary-action${!isDrawingArea ? " btn--pulse" : ""}`}
          onClick={onStartAreaDrawing}
        >
          Iniciar demarcação
        </button>

        {!mobile ? (
          <div className="drawing-actions drawing-actions--secondary">
            <button type="button" className="btn btn--ghost" onClick={onConcludeAreaDrawing} disabled={draftPolygonCoords.length < 3}>
              Concluir
            </button>
            <button type="button" className="btn btn--subtle" onClick={onClearAreaDrawing}>
              Limpar
            </button>
          </div>
        ) : null}

        <div className={`demarcation-status${areaReady ? " demarcation-status--success" : ""}`}>
          {areaReady ? "Área demarcada com sucesso." : "Adicione pelo menos 3 pontos para formar a área."}
        </div>
      </section>
      <UploadBox preview={areaPreview} onPreviewChange={setAreaPreview} required />
      </div>
      <div className="form-actions"><button className="btn btn--green" type="submit" disabled={isSavingArea}>{isSavingArea ? "Salvando..." : "Salvar área"}</button><button className="btn btn--red" type="button" onClick={onCancelArea} disabled={isSavingArea}>Cancelar</button></div>
    </form>
  );
}

function OccurrenceFormPanel(props) {
  const { areas, occurrenceForm, setOccurrenceForm, occurrencePreview, setOccurrencePreview, onSubmitOccurrence, isSavingOccurrence, occurrenceSuccessMessage, occurrenceErrorMessage, onCancelOccurrence, occurrenceLocation } = props;
  const selectedOccurrenceArea = areas.find((area) => area.id === occurrenceForm.areaId) ?? null;

  return (
    <form className="dark-form" onSubmit={onSubmitOccurrence}>
      <div className="dark-form__scroll">
      <div className="form-section-heading">
        <strong>Identificação do responsável</strong>
        <small>Informe quem está registrando esta ocorrência.</small>
      </div>
      <div className="field-row">
        <Field label="Nome do responsável"><input required autoComplete="name" value={occurrenceForm.reporterName} onChange={(event) => setOccurrenceForm((current) => ({ ...current, reporterName: event.target.value }))} placeholder="Nome completo" /></Field>
        <Field label="Função ou órgão"><ResponsibleRoleSelect required value={occurrenceForm.reporterRole} onChange={(value) => setOccurrenceForm((current) => ({ ...current, reporterRole: value }))} /></Field>
      </div>
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
                ? current.nextStatus || getSuggestedNextStatus(selectedOccurrenceArea?.status)
                : "",
            }))
          }
        />
        <span>Atualizar status da área nesta ocorrência</span>
      </label>
      {occurrenceForm.updateStatus ? (
        <Field label="Novo status da área">
          <select
            required
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
      {occurrenceErrorMessage ? <div className="form-feedback form-feedback--error">{occurrenceErrorMessage}</div> : null}
      {occurrenceSuccessMessage ? <div className="form-feedback form-feedback--success">{occurrenceSuccessMessage}</div> : null}
      <UploadBox preview={occurrencePreview} onPreviewChange={setOccurrencePreview} />
      </div>
      <div className="form-actions form-actions--occurrence"><button className="btn btn--green" type="submit" disabled={isSavingOccurrence}>{isSavingOccurrence ? "Registrando ocorrência..." : "Registrar ocorrência"}</button><button className="btn btn--red" type="button" onClick={onCancelOccurrence} disabled={isSavingOccurrence}>Cancelar</button></div>
    </form>
  );
}

function LegendCard() {
  return <section className="legend-card"><div className="legend-card__title-row"><h2>Legenda</h2><span className="legend-card__badge">Status</span></div><LegendContent /></section>;
}

function LegendContent() {
  const items = [
    {
      label: "Preservado",
      swatch: "green",
      description: "Área em boas condições ambientais, sem impactos significativos.",
    },
    {
      label: "Atenção",
      swatch: "yellow",
      description: "Área com sinais de alteração ou risco ambiental, requer monitoramento.",
    },
    {
      label: "Crítico",
      swatch: "red",
      description: "Área com degradação ambiental evidente, necessita intervenção urgente.",
    },
  ];

  return (
    <div className="legend-list">
      {items.map((item) => (
        <div className="legend-item" key={item.label}>
          <span className={`legend-swatch legend-swatch--${item.swatch}`}></span>
          <span className="legend-item__copy">
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusContent({ areas, onSelectArea }) {
  const total = areas.length;
  const statusItems = [
    { status: "preservado", label: "Preservadas", swatch: "green" },
    { status: "atencao", label: "Em atenção", swatch: "yellow" },
    { status: "critico", label: "Críticas", swatch: "red" },
  ].map((item) => {
    const filteredAreas = areas.filter((area) => normalizeAreaStatus(area.status) === item.status);
    return { ...item, filteredAreas, count: filteredAreas.length, percentage: total ? Math.round((filteredAreas.length / total) * 100) : 0 };
  });
  const preservedEnd = statusItems[0].percentage;
  const attentionEnd = preservedEnd + statusItems[1].percentage;
  const chartBackground = total
    ? `conic-gradient(#2fbf7a 0 ${preservedEnd}%, #f5bd38 ${preservedEnd}% ${attentionEnd}%, #ef5a5f ${attentionEnd}% 100%)`
    : "conic-gradient(#34424d 0 100%)";

  return (
    <div className="status-summary">
      <div className="status-summary__total">
        <span>Total monitorado</span>
        <strong>{total}</strong>
      </div>
      <section className="status-chart" aria-label="Gráfico da situação ambiental das áreas">
        <div className="status-chart__donut" style={{ background: chartBackground }} role="img" aria-label={`${statusItems[0].percentage}% preservadas, ${statusItems[1].percentage}% em atenção e ${statusItems[2].percentage}% críticas`}>
          <span><strong>{total}</strong><small>áreas</small></span>
        </div>
        <div className="status-chart__bars">
          {statusItems.map((item) => <div className={`status-chart__row status-chart__row--${item.swatch}`} key={item.status}>
            <div><span>{item.label}</span><strong>{item.count} · {item.percentage}%</strong></div>
            <i><b style={{ width: `${item.percentage}%` }} /></i>
          </div>)}
        </div>
      </section>
      <div className="status-summary__grid">
        {statusItems.map((item) => {
          return (
            <section key={item.status} className="status-summary__card">
              <div className="status-summary__header">
                <span className={`legend-swatch legend-swatch--${item.swatch}`}></span>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
              <div className="status-summary__areas">
                {item.filteredAreas.length ? (
                  item.filteredAreas.map((area) => (
                    <button type="button" key={area.id} onClick={() => onSelectArea(area)}>
                      <span>{area.name}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                  ))
                ) : (
                  <small>Nenhuma área</small>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MobileMapActions({ isDrawingArea, onOpenArea, onOpenOccurrence, onOpenLegend, onOpenStatus, onOpenLayers, onOpenHelp, onLocateUser, isLocatingUser, hasUserLocation }) {
  return (
    <>
      <div className="mobile-side-rail" aria-label="Ações rápidas do mapa">
        <MobileSideButton
          label={isLocatingUser ? "Localizando" : "Minha localização"}
          onClick={onLocateUser}
          active={hasUserLocation}
          loading={isLocatingUser}
        >
          <LocationIcon />
        </MobileSideButton>
        <MobileSideButton label="Camada" onClick={onOpenLayers}>
          <LayersIcon />
        </MobileSideButton>
        <MobileSideButton label="Status" onClick={onOpenStatus}>
          <StatusIcon />
        </MobileSideButton>
        <button type="button" className="mobile-side-help" onClick={onOpenHelp} aria-label="Abrir ajuda">
          <span aria-hidden="true">?</span>
          <strong>Ajuda</strong>
        </button>
      </div>
      <div className="mobile-fab-dock">
        <MobileFabButton label="Legenda" description="Entenda as cores e classificações do mapa." onClick={onOpenLegend} variant="legend">
          <LegendIcon />
        </MobileFabButton>
        <MobileFabButton label="Camada" description="Escolha as informações exibidas no mapa." onClick={onOpenLayers} variant="layers">
          <LayersIcon />
        </MobileFabButton>
        <MobileFabButton label="Ocorrência" description="Registre uma ocorrência em uma área cadastrada." onClick={onOpenOccurrence} danger>
          <AlertIcon />
        </MobileFabButton>
        <MobileFabButton label="Nova área" description="Cadastre uma nova área para monitoramento." onClick={onOpenArea} primary>
          <AreaIcon />
        </MobileFabButton>
      </div>
    </>
  );
}

function MobileSideButton({ label, children, onClick, active = false, loading = false }) {
  return (
    <button
      type="button"
      className={`mobile-side-button${active ? " is-active" : ""}${loading ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={loading}
    >
      <span className="mobile-side-button__icon" aria-hidden="true">{children}</span>
      <span>{label}</span>
    </button>
  );
}

function MobileFabButton({ label, description, children, onClick, primary = false, danger = false, variant = "" }) {
  const variantClass = primary
    ? " mobile-fab--primary"
    : danger
      ? " mobile-fab--danger"
      : variant
        ? ` mobile-fab--${variant}`
        : "";
  return (
    <button type="button" className={`mobile-fab${variantClass}`} onClick={onClick} aria-label={`${label}. ${description}`} data-tooltip={description}>
      <span className="mobile-fab__icon" aria-hidden="true">{children}</span>
      <span className="mobile-fab__label">{label}</span>
    </button>
  );
}

function createNotificationSummary(areas, occurrences) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isRecent = (value) => {
    const timestamp = new Date(value ?? 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  };
  const newAreas = (areas ?? []).filter((area) => isRecent(area.createdAt));
  const newOccurrences = (occurrences ?? []).filter((occurrence) => isRecent(occurrence.created_at ?? occurrence.createdAt));
  return {
    areas: newAreas.length,
    occurrences: newOccurrences.length,
    total: newAreas.length + newOccurrences.length,
  };
}

function HelpGuide() {
  const tips = [
    { title: "Legenda", description: "Entenda as cores e classificações do mapa." },
    { title: "Camada", description: "Escolha as informações exibidas no mapa." },
    { title: "Ocorrência", description: "Registre uma ocorrência em uma área cadastrada." },
    { title: "Nova área", description: "Cadastre uma nova área para monitoramento." },
  ];
  return (
    <div className="help-guide">
      <p className="help-guide__intro">Use os atalhos do mapa para consultar informações e registrar o monitoramento ambiental.</p>
      <div className="help-guide__tips">
        {tips.map((tip, index) => (
          <article className="help-tip" key={tip.title}>
            <span>{index + 1}</span>
            <div><strong>{tip.title}</strong><p>{tip.description}</p></div>
          </article>
        ))}
      </div>
      <div className="monitoring-flow" aria-label="Fluxo de monitoramento">
        <strong>Cadastrar área</strong><span>→</span><strong>Selecionar área</strong><span>→</span><strong>Registrar ocorrência</strong><span>→</span><strong>Monitorar</strong>
      </div>
    </div>
  );
}

function NotificationContent({ summary }) {
  return (
    <div className="notification-panel">
      <p className="notification-panel__period">Atualizações registradas nos últimos 7 dias.</p>
      <div className="notification-panel__list">
        <article className="notification-item notification-item--occurrence">
          <span aria-hidden="true"><AlertIcon /></span>
          <div>
            <strong>{String(summary.occurrences).padStart(2, "0")} {summary.occurrences === 1 ? "ocorrência nova" : "ocorrências novas"}</strong>
            <p>Registros vinculados às áreas monitoradas.</p>
          </div>
        </article>
        <article className="notification-item notification-item--area">
          <span aria-hidden="true"><AreaIcon /></span>
          <div>
            <strong>{String(summary.areas).padStart(2, "0")} {summary.areas === 1 ? "área nova cadastrada" : "áreas novas cadastradas"}</strong>
            <p>Novas áreas incluídas no monitoramento.</p>
          </div>
        </article>
      </div>
      {summary.total === 0 ? <p className="notification-panel__empty">Nenhuma novidade registrada neste período.</p> : null}
    </div>
  );
}

function MobileFirstVisitTips({ onDismiss }) {
  return (
    <aside className="mobile-first-tips" aria-label="Dicas rápidas dos botões">
      <div className="mobile-first-tips__header">
        <strong>Dicas rápidas</strong>
        <button type="button" onClick={onDismiss} aria-label="Fechar dicas">×</button>
      </div>
      <p><strong>Legenda:</strong> cores do mapa · <strong>Camada:</strong> visualização</p>
      <p><strong>Ocorrência:</strong> registrar em uma área · <strong>Nova área:</strong> cadastrar</p>
    </aside>
  );
}

function OccurrenceGuide({ areas, onSelectArea, onCreateArea, onCancel }) {
  const [query, setQuery] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const normalizedQuery = normalizeAreaName(query);
  const filteredAreas = areas.filter((area) => !normalizedQuery || [area.name, area.category, area.region, area.impact]
    .some((value) => normalizeAreaName(value || "").includes(normalizedQuery)));
  const selectedArea = areas.find((area) => String(area.id) === String(selectedAreaId)) ?? null;

  return (
    <div className="occurrence-guide">
      <div className="occurrence-guide__content">
      <div className="occurrence-guide__message">
        <AlertIcon />
        <div>
          <strong>Selecione uma área cadastrada para registrar uma ocorrência.</strong>
          <p>Toda ocorrência precisa ficar vinculada a uma área monitorada.</p>
        </div>
      </div>
      {areas.length ? <>
        <label className="occurrence-area-search"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, região ou categoria..." aria-label="Buscar área cadastrada" /></label>
        <div className="occurrence-area-list" aria-label="Áreas disponíveis">
        {filteredAreas.map((area) => <button type="button" key={area.id} className={`occurrence-area-option${String(selectedAreaId) === String(area.id) ? " is-selected" : ""}`} onClick={() => setSelectedAreaId(area.id)} aria-pressed={String(selectedAreaId) === String(area.id)}>
          <span className={`legend-swatch legend-swatch--${area.status === "preservado" ? "green" : area.status === "atencao" ? "yellow" : "red"}`} />
          <span><strong>{area.name || "Área cadastrada"}</strong><small>{area.region || "Região não informada"}</small><small>{area.category || "Sem categoria"} · {statusLabel(area.status)}</small></span>
          <i className="occurrence-area-option__check" aria-hidden="true">✓</i>
        </button>)}
        {!filteredAreas.length ? <p className="occurrence-guide__empty">Nenhuma área corresponde à busca.</p> : null}
        </div>
        {selectedArea ? <div className="occurrence-selected-area"><span>Área escolhida</span><strong>{selectedArea.name}</strong><small>{selectedArea.impact || selectedArea.description || "Sem observação informada."}</small></div> : null}
      </> : <p className="occurrence-guide__empty">Nenhuma área cadastrada. Cadastre uma área antes de registrar a ocorrência.</p>}
      </div>
      <div className="occurrence-guide__actions">
        {areas.length ? <button type="button" className="btn btn--green" onClick={() => onSelectArea(selectedArea)} disabled={!selectedArea}>Continuar com esta área</button> : null}
        <button type="button" className="btn btn--ghost" onClick={onCreateArea}>Cadastrar nova área</button>
        <button type="button" className="btn btn--red" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

function AreaCreatedNextStep({ area, onRegisterOccurrence, onFinish }) {
  return (
    <div className="area-created-step">
      <div className="area-created-step__success">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>{area?.name || "Nova área"} foi cadastrada com sucesso.</strong>
          <p>Você pode registrar uma ocorrência agora; a área já será vinculada automaticamente.</p>
        </div>
      </div>
      <div className="monitoring-flow" aria-label="Próxima etapa do monitoramento">
        <strong>Área cadastrada</strong><span>→</span><strong>Registrar ocorrência</strong><span>→</span><strong>Monitorar</strong>
      </div>
      <div className="area-created-step__actions">
        <button type="button" className="btn btn--green" onClick={onRegisterOccurrence}>Registrar ocorrência agora</button>
        <button type="button" className="btn btn--ghost" onClick={onFinish}>Concluir sem ocorrência</button>
      </div>
    </div>
  );
}

function BottomSheet({ isOpen, title, onClose, children, large = false }) {
  if (!isOpen || typeof document === "undefined") return null;
  return createPortal(
    <div className="bottom-sheet-backdrop" onClick={onClose}>
      <section className={`bottom-sheet${large ? " bottom-sheet--large" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="bottom-sheet__handle" />
        <header className="bottom-sheet__header">
          <h2>{title}</h2>
          <button type="button" className="bottom-sheet__close" onClick={onClose}>Fechar</button>
        </header>
        <div className="bottom-sheet__content">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

function LayerSheet({ activeBaseMap, onChangeBaseMap, layerFilters, onToggleLayer, regionSummary = [] }) {
  const filters = [
    { key: "preservado", label: "Áreas preservadas", icon: <span className="legend-swatch legend-swatch--green" />, tone: "green" },
    { key: "atencao", label: "Áreas em atenção", icon: <span className="legend-swatch legend-swatch--yellow" />, tone: "yellow" },
    { key: "critico", label: "Áreas críticas", icon: <span className="legend-swatch legend-swatch--red" />, tone: "red" },
  ].map((filter) => ({ ...filter, count: regionSummary.find((item) => item.key === filter.key)?.value ?? 0 }));
  return (
    <div className="layer-sheet">
      <button type="button" className={`layer-sheet__option${activeBaseMap === "satellite" ? " is-active" : ""}`} onClick={() => onChangeBaseMap("satellite")}>
        <strong>Satélite</strong>
        <span>Mais detalhe visual da cobertura do território.</span>
      </button>
      <button type="button" className={`layer-sheet__option${activeBaseMap === "street" ? " is-active" : ""}`} onClick={() => onChangeBaseMap("street")}>
        <strong>Mapa padrão</strong>
        <span>Melhor leitura de localidades, vias e nomes da região.</span>
      </button>
      <div className="layer-sheet__filters">
        {filters.map((filter) => (
          <button type="button" key={filter.key} className="layer-sheet__filter" onClick={() => onToggleLayer(filter.key)} aria-pressed={layerFilters[filter.key]}>
            <span className={`filter-icon filter-icon--${filter.tone}`}>{filter.icon}</span><span className="layer-sheet__filter-label">{filter.label}</span><strong className="filter-count" aria-label={`${filter.count} áreas`}>{filter.count}</strong><i className={`gis-switch${layerFilters[filter.key] ? " is-on" : ""}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 4.5c-5.6.2-9.6 1.9-12 5.1-2.2 2.8-3 6.3-2.5 9.9 3.6.5 7.1-.4 9.9-2.5 3.2-2.4 4.9-6.4 5.1-12Z" />
      <path d="M8.2 15.8c2-1.6 4.1-3 6.5-4.1" />
      <path d="M10.7 18.9c.2-1.5-.1-3.1-.8-4.5" />
    </svg>
  );
}

function AreaIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M8 14h12v6H8z"/><path d="M10 8l4-2"/></svg>;
}

function AlertIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>;
}

function LegendIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>;
}

function LayersIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg>;
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="16" cy="16" r="8" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
      <path d="M16 3v5M16 24v5M3 16h5M24 16h5" />
    </svg>
  );
}

function StatusIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 19V9"/><path d="M12 19V5"/><path d="M18 19v-8"/></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
}

function BoundaryLayer({ geojson }) {
  return <GeoJSON data={geojson} style={BOUNDARY_STYLE} />;
}

function MapFocusController({ focus }) {
  const map = useMap();

  useEffect(() => {
    if (!focus) return;
    map.setView(focus.center, focus.zoom, { animate: true });
  }, [focus, map]);

  return null;
}

function MapInteractionLock({ locked }) {
  const map = useMap();

  useEffect(() => {
    const handlers = [
      map.dragging,
      map.scrollWheelZoom,
      map.touchZoom,
      map.doubleClickZoom,
      map.boxZoom,
      map.keyboard,
      map.tap,
    ].filter(Boolean);
    handlers.forEach((handler) => locked ? handler.disable() : handler.enable());
    return () => handlers.forEach((handler) => handler.enable());
  }, [locked, map]);

  return null;
}

function UserLocationLayer({ location }) {
  const map = useMap();

  useEffect(() => {
    if (!location) return;
    map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), LOCAL_ZOOM), {
      animate: true,
    });
  }, [location, map]);

  if (!location) return null;

  return (
    <>
      <CircleMarker
        center={[location.latitude, location.longitude]}
        radius={Math.max(24, Math.min(80, (location.accuracy ?? 0) / 8))}
        pathOptions={{
          color: "#60d8ff",
          weight: 1,
          opacity: 0.28,
          fillColor: "#1b9bd7",
          fillOpacity: 0.1,
        }}
        interactive={false}
      />
      <Marker
        position={[location.latitude, location.longitude]}
        icon={getUserLocationIcon()}
        zIndexOffset={1200}
        interactive={false}
      >
        <Tooltip permanent direction="top" offset={[0, -24]} className="selection-tooltip user-location-tooltip">
          Minha localização
        </Tooltip>
      </Marker>
    </>
  );
}

function MapClickHandler({ drawingEnabled, onDrawPoint, onMapBlankClick }) {
  useMapEvents({
    click(event) {
      if (drawingEnabled) {
        onDrawPoint(event.latlng);
        return;
      }
      onMapBlankClick?.();
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

function CategoriaSelect({ value, onChange, required = false }) {
  const isCustomCategory = value && !CATEGORIES.includes(value);
  const selectedValue = isCustomCategory ? "Outro" : value;

  return (
    <div className="category-select-wrap">
      <select
        required={required}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value === "Outro" ? "" : event.target.value)}
      >
        <option value="">Selecione uma categoria</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category} ({CATEGORY_HINTS[category]})
          </option>
        ))}
      </select>

      {selectedValue === "Outro" ? (
        <input
          type="text"
          required={required}
          value={isCustomCategory ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Digite a categoria..."
        />
      ) : null}
    </div>
  );
}

function UploadBox({ preview, onPreviewChange, required = false }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    setIsOptimizing(true);
    try {
      onPreviewChange(await optimizeImageFile(file));
    } finally {
      setIsOptimizing(false);
    }
  }
  return <label className={`upload-box${isDragOver ? " is-dragover" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }} onDragLeave={(event) => { event.preventDefault(); setIsDragOver(false); }} onDrop={(event) => { event.preventDefault(); setIsDragOver(false); handleFile(event.dataTransfer.files?.[0]); }}><input className="upload-box__input" type="file" accept="image/*" required={required && !preview} disabled={isOptimizing} onChange={(event) => handleFile(event.target.files?.[0])} />{preview ? <div className="upload-box__preview"><img src={preview} alt="Pre-visualizacao da imagem enviada" /><button type="button" className="upload-box__remove" onClick={(event) => { event.preventDefault(); onPreviewChange(null); }}>Remover imagem</button></div> : <div className="upload-box__prompt"><strong>{isOptimizing ? "Otimizando imagem..." : "Arraste uma imagem ou clique para selecionar"}</strong><span>{isOptimizing ? "Convertendo para um formato mais leve" : "PNG, JPG ou WEBP — otimização automática"}</span></div>}</label>;
}

async function optimizeImageFile(file) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = sourceUrl;
    });
    const maxDimension = 960;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.64);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function preloadImageSource(source) {
  if (!source || typeof Image === "undefined") return Promise.resolve();
  if (IMAGE_PRELOAD_CACHE.has(source)) return IMAGE_PRELOAD_CACHE.get(source);

  const preloadPromise = new Promise((resolve) => {
    const image = new Image();
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
      } catch {
        // A imagem já está disponível mesmo quando o navegador não conclui decode().
      }
      resolve();
    };
    image.onerror = resolve;
    image.src = source;
  });
  IMAGE_PRELOAD_CACHE.set(source, preloadPromise);
  return preloadPromise;
}

function DetailCard({ area, history = [], occurrences = [], onClose, onReturnToReports }) {
  const latestChange = history[0] ?? null;
  const [expanded, setExpanded] = useState(false);

  function toggleExpanded(event) {
    event.preventDefault();
    event.stopPropagation();
    setExpanded((current) => !current);
  }

  function renderCard(isExpanded) {
    return <article className={`detail-card${isExpanded ? " is-expanded" : " is-collapsed"}`}>
      <div className="detail-card__close-row">
        <button type="button" onClick={onClose} aria-label="Fechar detalhes da área">×</button>
      </div>
      <img src={area.image} alt={area.name} loading="eager" fetchPriority="high" decoding="async" />
      <div className="detail-card__body">
        <h3>{area.name}</h3>
        <div className="meta-row"><span>{area.category}</span><span>{statusLabel(area.status)}</span></div>
        {area.createdAt ? <small>Registrado em {formatDateTime(area.createdAt)}</small> : null}
        <div className="area-status-block">
          <span>Status atual</span>
          <strong className={`impact-pill impact-pill--${area.status}`}>{statusLabel(area.status)}</strong>
        </div>
        <button
          type="button"
          className="detail-card__expand"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Recolher cartão ↑" : "Expandir cartão ↗"}
        </button>
        <div className="detail-card__extended">
        {onReturnToReports ? <button type="button" className="detail-card__back-report" onClick={onReturnToReports}>← Voltar aos relatórios</button> : null}
        {latestChange ? (
          <div className="area-change-card">
            <span>Última mudança</span>
            <strong>{statusUpdateLabel(latestChange.previousStatus)} {"\u2192"} {statusUpdateLabel(latestChange.newStatus)}</strong>
            <small>{formatDateTime(latestChange.changedAt)}</small>
            <p>Motivo: {latestChange.impact || latestChange.description || "Ocorrência registrada sem resumo."}</p>
            <small>Ocorrência: {latestChange.occurrenceId ? String(latestChange.occurrenceId).slice(0, 8) : "vinculada"}</small>
          </div>
        ) : (
          <div className="area-change-card area-change-card--empty">
            <span>Histórico</span>
            <p>Ainda não há mudança de status registrada para esta área.</p>
          </div>
        )}
        <p>{area.description}</p>
        <span className={`impact-pill impact-pill--${area.status}`}>{area.impact}</span>
        {history.length ? (
          <div className="area-history">
            <strong>Histórico de alterações</strong>
            {history.slice(0, 4).map((item) => (
              <div className="area-history__item" key={item.id}>
                <span>{formatDateTime(item.changedAt)} — {statusUpdateLabel(item.previousStatus)} {"\u2192"} {statusUpdateLabel(item.newStatus)}</span>
                <small>Ocorrência: {item.description || item.impact || "Sem descrição resumida."}</small>
                {item.changedBy ? <small>Responsável: {item.changedBy}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="occurrence-history">
          <strong>Histórico de ocorrências</strong>
          {occurrences.length ? occurrences.map((occurrence) => (
            <div className="occurrence-history__item" key={occurrence.id}>
              <div>
                <strong>{occurrence.impact || "Ocorrência registrada"}</strong>
                <span>{formatDateTime(occurrence.created_at)}</span>
              </div>
              <p>{occurrence.description || "Sem descrição informada."}</p>
              <small>
                Status: {occurrence.status_updated && occurrence.new_status
                  ? statusLabel(occurrence.new_status)
                  : "Mantido"}
              </small>
            </div>
          )) : <p className="occurrence-history__empty">Nenhuma ocorrência registrada para esta área.</p>}
        </div>
        </div>
      </div>
    </article>;
  }

  if (expanded && typeof document !== "undefined") {
    return <>
      {renderCard(false)}
      {createPortal(
        <div className="detail-card-modal" onClick={() => setExpanded(false)}>
          <div className="detail-card-modal__panel" onClick={(event) => event.stopPropagation()}>{renderCard(true)}</div>
        </div>,
        document.body,
      )}
    </>;
  }
  return renderCard(false);
}

function HoverCard({ area, onClose }) {
  return <article className="hover-card"><button type="button" className="hover-card__close" onClick={onClose} aria-label="Fechar informações da área">×</button><img src={area.image} alt={area.name} /><div className="hover-card__body"><h3>{area.name}</h3><div className="meta-row"><span>{area.category}</span><span>{statusLabel(area.status)}</span></div>{area.createdAt ? <small>Registrado em {formatDateTime(area.createdAt)}</small> : null}{isRecentStatusChange(area) ? <span className="recent-badge">Atualizado recentemente</span> : null}<p>{area.impact}</p><span className={`impact-pill impact-pill--${area.status}`}>{statusLabel(area.status)}</span></div></article>;
}

function ResponsibleRoleSelect({ value, onChange, required = false }) {
  const otherValue = "Outro — especificar";
  const isCustomRole = Boolean(value) && value !== otherValue && !RESPONSIBLE_ROLES.includes(value);
  const selectedValue = isCustomRole ? otherValue : value;

  return (
    <div className="category-select-wrap">
      <select
        required={required}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione sua função ou órgão</option>
        {RESPONSIBLE_ROLES.map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
        <option value={otherValue}>{otherValue}</option>
      </select>
      {selectedValue === otherValue ? (
        <input
          type="text"
          required={required}
          value={isCustomRole ? value : ""}
          onChange={(event) => onChange(event.target.value || otherValue)}
          placeholder="Digite sua função ou o nome do órgão"
        />
      ) : null}
    </div>
  );
}

function ClusterCard({ areas }) {
  const statusCounts = areas.reduce(
    (counts, area) => ({ ...counts, [area.status]: (counts[area.status] ?? 0) + 1 }),
    {},
  );
  return (
    <article className="cluster-card">
      <strong>{areas.length} áreas monitoradas</strong>
      <div className="cluster-card__status">
        <span><i className="legend-swatch legend-swatch--green"></i>{statusCounts.preservado ?? 0}</span>
        <span><i className="legend-swatch legend-swatch--yellow"></i>{statusCounts.atencao ?? 0}</span>
        <span><i className="legend-swatch legend-swatch--red"></i>{statusCounts.critico ?? 0}</span>
      </div>
      <small>Toque para aproximar</small>
    </article>
  );
}

function emptyAreaForm() {
  return { reporterName: "", reporterRole: "", name: "", category: "", status: "preservado", impact: "", description: "", polygonCoords: [] };
}

function emptyOccurrenceForm(areaId = "") {
  return {
    areaId,
    reporterName: "",
    reporterRole: "",
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
    return Array.isArray(parsed) ? parsed.map(normalizeAreaShape) : [];
  } catch {
    return [];
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
    region: row.region || REGIONS[0].name,
    status: normalizeAreaStatus(row.status),
    impact: row.impact ?? "Sem impacto informado",
    description: row.description ?? "Sem descrição informada",
    polygonCoords,
    latitude,
    longitude,
    image: row.image_url || createPlaceholderImage(row.name ?? "Área monitorada", statusToColor(row.status ?? "atencao")),
    createdAt: row.created_at ?? null,
    lastOccurrenceId: row.last_occurrence_id ? String(row.last_occurrence_id) : null,
    lastStatusReviewAt: row.last_status_review_at ?? null,
  };
}

function normalizeAreaShape(area) {
  const polygonCoords = normalizePolygonCoords(area?.polygonCoords, area?.latitude, area?.longitude);
  const [latitude, longitude] = computeCentroid(polygonCoords);
  return {
    ...area,
    region: area?.region || REGIONS[0].name,
    polygonCoords,
    latitude,
    longitude,
    image: area?.image || createPlaceholderImage(
      area?.name || "Área monitorada",
      statusToColor(area?.status || "atencao"),
    ),
  };
}

function mapStatusHistoryRowToApp(row) {
  const occurrence = row?.occurrences ?? row?.occurrence ?? null;
  return {
    id: String(row?.id ?? createId()),
    areaId: String(row?.area_id ?? ""),
    occurrenceId: row?.occurrence_id ? String(row.occurrence_id) : occurrence?.id ? String(occurrence.id) : "",
    previousStatus: row?.previous_status ?? "atencao",
    newStatus: row?.new_status ?? "atencao",
    changedBy: row?.changed_by ?? occurrence?.created_by ?? "",
    changedAt: row?.changed_at ?? occurrence?.created_at ?? new Date().toISOString(),
    impact: row?.occurrence_impact ?? occurrence?.impact ?? "",
    description: row?.occurrence_description ?? occurrence?.description ?? "",
  };
}

function buildStatusHistoryEntry({ area, occurrenceId, previousStatus, newStatus, impact, description, changedAt }) {
  return {
    id: String(occurrenceId || createId()),
    areaId: String(area.id),
    areaName: area.name,
    occurrenceId: String(occurrenceId || ""),
    previousStatus,
    newStatus,
    changedBy: "",
    changedAt,
    impact,
    description,
  };
}

function createRegion(name, center = REGIONAL_CENTER, zoom = LOCAL_ZOOM) {
  return {
    id: regionIdFromName(name),
    name,
    center,
    zoom,
  };
}

function regionIdFromName(name) {
  return normalizeAreaName(name || REGIONS[0].name).replace(/[^a-z0-9]+/g, "-") || REGIONS[0].id;
}

function mergeRegions(current, nextRegions) {
  const byId = new Map(current.map((region) => [region.id, region]));
  nextRegions.forEach((region) => {
    if (!region?.id) return;
    byId.set(region.id, { ...byId.get(region.id), ...region });
  });
  return Array.from(byId.values());
}

function regionsFromAreas(areas) {
  return Array.from(
    new Map(
      areas
        .map((area) => area.region || REGIONS[0].name)
        .filter(Boolean)
        .map((regionName) => [regionIdFromName(regionName), createRegion(regionName)]),
    ).values(),
  );
}

function filterAreasByRegion(areas, regionName) {
  const normalizedRegion = normalizeAreaName(regionName);
  return areas.filter((area) => normalizeAreaName(area.region || REGIONS[0].name) === normalizedRegion);
}

function SearchResultLayer({ result }) {
  if (!result) return null;
  return <Marker position={[result.latitude, result.longitude]} icon={SEARCH_RESULT_ICON} zIndexOffset={900}>
    <Tooltip permanent direction="top" offset={[0, -38]} opacity={1} className="search-result-tooltip">{result.name}</Tooltip>
  </Marker>;
}

function MapViewportSync() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const refresh = () => map.invalidateSize({ animate: false, pan: false });
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(refresh));
    const timers = [150, 500, 1200].map((delay) => window.setTimeout(refresh, delay));
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
    observer?.observe(container);
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("orientationchange", refresh, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    };
  }, [map]);

  return null;
}

function WaterIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/><path d="M9 15.5c.6 1.2 1.6 1.8 3 1.8"/></svg>;
}

function BoundaryIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 3" /></svg>;
}

function filterAreasByLayers(areas, filters) {
  return areas.filter((area) => filters[normalizeAreaStatus(area.status)] !== false);
}

function regionHasAreas(areas, regionName) {
  return filterAreasByRegion(areas, regionName).length > 0;
}

function countOccurrencesForAreas(occurrences, areas) {
  const areaIds = new Set(areas.map((area) => String(area.id)));
  return occurrences.filter((occurrence) => areaIds.has(String(occurrence.area_id))).length;
}

function getAreaOccurrences(occurrences, areaId) {
  return (occurrences ?? [])
    .filter((occurrence) => String(occurrence.area_id ?? occurrence.areaId ?? "") === String(areaId))
    .sort((left, right) => new Date(right.created_at ?? right.createdAt ?? 0) - new Date(left.created_at ?? left.createdAt ?? 0));
}

function getAreaStatusHistory(history, areaId) {
  return (history ?? [])
    .filter((item) => String(item.areaId) === String(areaId))
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
}

function getRecentStatusChanges(history, areas) {
  const areaNames = new Map(areas.map((area) => [String(area.id), area.name]));
  return (history ?? [])
    .map((item) => ({ ...item, areaName: item.areaName || areaNames.get(String(item.areaId)) || "Área monitorada" }))
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
}

function isRecentStatusChange(area) {
  if (!area?.lastStatusReviewAt) return false;
  const changedAt = new Date(area.lastStatusReviewAt).getTime();
  if (!Number.isFinite(changedAt)) return false;
  return Date.now() - changedAt < 1000 * 60 * 60 * 24 * 3;
}

function getBrowserPosition() {
  const requestPosition = (options) => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });

  return requestPosition({
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0,
  }).catch((error) => {
    const permissionDenied = error?.code === error?.PERMISSION_DENIED || error?.code === 1;
    if (permissionDenied) throw error;

    return requestPosition({
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 30000,
    });
  });
}

async function reverseGeocodeCity(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: { "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  if (!response.ok) return "";
  const data = await response.json();
  const address = data?.address ?? {};
  return (
    address.city ||
    address.town ||
    address.municipality ||
    address.village ||
    address.city_district ||
    address.county ||
    address.state_district ||
    address.state ||
    ""
  );
}

function getRegionNameAtPoint(geojson, latitude, longitude) {
  if (!geojson || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const features = geojson.type === "FeatureCollection" ? geojson.features : [geojson];
  const matchingFeature = features.find((feature) => geometryContainsPoint(feature?.geometry, longitude, latitude));
  return matchingFeature?.properties?.name || matchingFeature?.properties?.municipality || "";
}

function geometryContainsPoint(geometry, longitude, latitude) {
  if (!geometry?.coordinates) return false;
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  return polygons.some((polygon) => {
    const [outerRing, ...holes] = polygon;
    return pointIsInsideRing(longitude, latitude, outerRing)
      && !holes.some((hole) => pointIsInsideRing(longitude, latitude, hole));
  });
}

function pointIsInsideRing(longitude, latitude, ring = []) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = ring[index] ?? [];
    const [previousLongitude, previousLatitude] = ring[previous] ?? [];
    const crossesLatitude = currentLatitude > latitude !== previousLatitude > latitude;
    const intersectionLongitude = crossesLatitude
      ? ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
        / (previousLatitude - currentLatitude) + currentLongitude
      : Number.POSITIVE_INFINITY;
    if (crossesLatitude && longitude < intersectionLongitude) inside = !inside;
  }
  return inside;
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

function getSupabaseFriendlyError(error) {
  const message = String(error?.message ?? "");
  if (message.toLowerCase().includes("invalid api key")) {
    return "Chave do Supabase invalida. Use o botao de copiar da Publishable key default em Project Settings > API Keys. Na Vercel, salve em VITE_SUPABASE_ANON_KEY ou VITE_SUPABASE_PUBLISHABLE_KEY e faca um novo deploy.";
  }
  if (message.toLowerCase().includes("permission denied") || message.toLowerCase().includes("row-level security")) {
    return "Permissão negada no Supabase. Verifique as políticas RLS da tabela areas.";
  }
  if (message.toLowerCase().includes("schema cache") && message.toLowerCase().includes("region")) {
    return "Banco conectado, mas a coluna region ainda não existe na tabela areas. Execute o arquivo supabase/schema.sql no SQL Editor do Supabase e tente novamente.";
  }
  if (message.toLowerCase().includes("relation") && message.toLowerCase().includes("does not exist")) {
    return "Tabela não encontrada no Supabase. Execute o arquivo supabase/schema.sql no SQL Editor.";
  }
  return message || "Tente novamente.";
}

function createMapFocus(area) {
  return {
    id: `${area.id}-${Date.now()}`,
    center: [area.latitude, area.longitude],
    zoom: LOCAL_ZOOM,
  };
}

function getMarkerIcon(status, isRecentlyUpdated = false) {
  return L.divIcon({
    className: "environment-marker-icon",
    html: `<span class="environment-marker environment-marker--${status}${isRecentlyUpdated ? " environment-marker--recent" : ""}">${getMarkerSymbol(status)}</span>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

function isMissingOccurrenceRpc(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202"
    || (message.includes("could not find the function") && message.includes("register_occurrence_with_status"));
}

function isMissingOccurrencesTable(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST205"
    || (message.includes("could not find the table") && message.includes("occurrences"));
}

function getMarkerSymbol(status) {
  if (status === "atencao") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>';
  }
  if (status === "critico") {
    return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M12 22c4 0 7-2.8 7-6.8 0-2.7-1.6-4.8-3.6-6.8-.6 2-1.8 3-3.1 3.4.3-3.5-1.3-6.1-4.1-8.8.1 3.7-3.2 5.8-3.2 9.6C5 18.4 8 22 12 22Z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 4.5c-5.6.2-9.6 1.9-12 5.1-2.2 2.8-3 6.3-2.5 9.9 3.6.5 7.1-.4 9.9-2.5 3.2-2.4 4.9-6.4 5.1-12Z"/><path d="M8.2 15.8c2-1.6 4.1-3 6.5-4.1"/></svg>';
}

function getUserLocationIcon() {
  return L.divIcon({
    className: "selected-location-icon",
    html: '<span class="selected-location-pin"><span></span></span>',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function getClusterIcon(areas) {
  const dominantStatus = getDominantStatus(areas);
  const dots = ["preservado", "atencao", "critico"]
    .filter((status) => areas.some((area) => area.status === status))
    .map((status) => `<span class="cluster-marker__dot cluster-marker__dot--${status}"></span>`)
    .join("");

  return L.divIcon({
    className: "cluster-marker-icon",
    html: `<span class="cluster-marker cluster-marker--${dominantStatus}"><span class="cluster-marker__count">${areas.length}</span><span class="cluster-marker__dots">${dots}</span></span>`,
    iconSize: [58, 58],
    iconAnchor: [29, 29],
  });
}

function createAreaClusters(areas, zoom) {
  if (zoom >= LOCAL_ZOOM || areas.length <= 1) {
    return areas.map((area) => ({
      id: area.id,
      center: [area.latitude, area.longitude],
      areas: [area],
    }));
  }

  const gridSize = zoom <= 7 ? 0.42 : zoom <= 10 ? 0.18 : 0.075;
  const clusters = new Map();
  areas.forEach((area) => {
    const key = `${Math.round(area.latitude / gridSize)}:${Math.round(area.longitude / gridSize)}`;
    const current = clusters.get(key) ?? [];
    current.push(area);
    clusters.set(key, current);
  });

  return Array.from(clusters.entries()).map(([key, groupedAreas]) => ({
    id: `cluster-${key}`,
    center: computeCentroid(groupedAreas.map((area) => [area.latitude, area.longitude])),
    areas: groupedAreas,
  }));
}

function getDominantStatus(areas) {
  if (areas.some((area) => area.status === "critico")) return "critico";
  if (areas.some((area) => area.status === "atencao")) return "atencao";
  return "preservado";
}

function getAreaPolygonStyle(status, isHighlighted) {
  const color = statusToColor(status);

  return {
    color,
    weight: isHighlighted ? 4 : 2.5,
    opacity: isHighlighted ? 1 : 0.9,
    fillColor: color,
    fillOpacity: isHighlighted ? 0.48 : 0.34,
    lineCap: "round",
    lineJoin: "round",
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
  const normalizedStatus = normalizeAreaStatus(status);
  if (normalizedStatus === "preservado") return "Preservado";
  if (normalizedStatus === "atencao") return "Atenção";
  return "Crítico";
}

function normalizeAreaStatus(status) {
  const normalized = String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (normalized.includes("preserv") || normalized === "bom") return "preservado";
  if (normalized.includes("critic") || normalized.includes("degrad") || normalized === "ruim") return "critico";
  return "atencao";
}

function areaStatusObservationPlaceholder(status) {
  if (status === "preservado") return "Ex.: Área conservada, sem impactos ambientais visíveis";
  if (status === "critico") return "Ex.: Degradação intensa com necessidade de intervenção";
  return "Ex.: Pressão moderada por descarte irregular";
}

function statusUpdateLabel(status) {
  if (status === "preservado") return "Preservado";
  if (status === "atencao") return "Em atenção";
  return "Crítico";
}

function getSuggestedNextStatus(currentStatus) {
  if (currentStatus === "preservado") return "atencao";
  if (currentStatus === "atencao") return "critico";
  return "atencao";
}

function statusToColor(status) {
  if (status === "preservado") return "#2fb36f";
  if (status === "atencao") return "#e8ba39";
  return "#dd5757";
}

function formatDateTime(value) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function createPlaceholderImage(title, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460"><defs><linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="${color}" stop-opacity="0.96" /><stop offset="100%" stop-color="#08111f" stop-opacity="1" /></linearGradient><radialGradient id="glow"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="800" height="460" fill="url(#g)"/><circle cx="650" cy="95" r="150" fill="url(#glow)"/><path d="M0 350 C140 280,220 390,360 320 S580 235,800 335 L800 460 L0 460 Z" fill="rgba(255,255,255,0.1)"/><path d="M382 122c-78 28-121 92-104 159 61 8 128-28 151-96-2 58-31 105-86 139" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
