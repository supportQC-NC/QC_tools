// src/components/AdminRoute.jsx
import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";

const AdminRoute = () => {
  const { userInfo } = useSelector((state) => state.auth);

  // Debug - à retirer après
  console.log("AdminRoute - userInfo:", userInfo);
  console.log("AdminRoute - role:", userInfo?.role);

  if (!userInfo) {
    console.log("AdminRoute - Pas de userInfo, redirect login");
    return <Navigate to="/login" replace />;
  }

  if (userInfo.role !== "admin") {
    console.log("AdminRoute - Pas admin, redirect /");
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminRoute;
