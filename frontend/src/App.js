import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import Header from "./components/Global/Header/Header";
import Footer from "./components/Global/Footer/Footer";
import Sidebar from "./components/Global/Sidebar/Sidebar";
import Login from "./screens/LoginScreen/LoginScreen";
import "./index.css";
import { SidebarProvider } from "./contexte/SidebarContext";
import NotificationsSync from "./components/Global/Notifications/NotificationsSync";

const PUBLIC_ROUTES = ["/login", "/forgot-password"];

// Les écrans sont des chunks chargés à la demande (React.lazy dans index.js) :
// ce repli s'affiche le temps du PREMIER téléchargement d'un écran — ensuite
// le chunk est en cache navigateur et la navigation est instantanée.
const ChargementEcran = () => (
  <div className="chargement-ecran" role="status">
    Chargement…
  </div>
);

const App = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const { pathname } = useLocation();

  const isPublicRoute =
    PUBLIC_ROUTES.includes(pathname) ||
    pathname.startsWith("/reset-password/");

  if (!userInfo && !isPublicRoute) {
    return <Login />;
  }

  if (!userInfo && isPublicRoute) {
    return (
      <Suspense fallback={<ChargementEcran />}>
        <Outlet />
      </Suspense>
    );
  }

  return (
    <>
    
    <SidebarProvider>
      <NotificationsSync />
      <div className="app">
        <Header />
        <div className="app-body">
          <Sidebar />
          <main className="main-content">
            <Suspense fallback={<ChargementEcran />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <Footer />
      </div>
    </SidebarProvider>
    </>
  );
};

export default App;