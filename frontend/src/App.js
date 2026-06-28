import { Outlet, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import Header from "./components/Global/Header/Header";
import Footer from "./components/Global/Footer/Footer";
import Sidebar from "./components/Global/Sidebar/Sidebar";
import Login from "./screens/LoginScreen/LoginScreen";
import "./index.css";
import { SidebarProvider } from "./contexte/SidebarContext";

const PUBLIC_ROUTES = ["/login", "/forgot-password"];

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
    return <Outlet />;
  }

  return (
    <>
    
    <SidebarProvider>
      <div className="app">
        <Header />
        <div className="app-body">
          <Sidebar />
          <main className="main-content">
            <Outlet />
          </main>
        </div>
        <Footer />
      </div>
    </SidebarProvider>
    </>
  );
};

export default App;