import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Falha inesperada na interface do mapa.", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-state">
          <div>
            <strong>Não foi possível exibir o mapa neste momento.</strong>
            <p>Atualize a página para tentar novamente. Seus registros permanecem salvos no Supabase.</p>
            <button type="button" onClick={() => window.location.reload()}>Atualizar mapa</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
