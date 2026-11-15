import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import "./LoginScreen.css";
import {
  useLoginMutation,
  useLoginBadgeMutation,
} from "../../slices/userApiSlice";
import { setCredentials } from "../../slices/authSlice";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Connexion par badge : le bip remplit `badge` (déclenché à 13 chiffres —
  // beaucoup de douchettes n'envoient pas d'Entrée), puis l'agent tape son
  // code PIN. Le badge seul ne connecte jamais (voir backend).
  const [mode, setMode] = useState("email"); // "email" | "badge"
  const [badge, setBadge] = useState("");
  const [pin, setPin] = useState("");
  const badgeRef = useRef(null);
  const pinRef = useRef(null);

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [login, { isLoading }] = useLoginMutation();
  const [loginBadge, { isLoading: loadingBadge }] = useLoginBadgeMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  // À l'ouverture du mode badge, le focus va au champ de scan ; le PIN est
  // remis à zéro (un PIN resté d'un essai précédent surprendrait).
  useEffect(() => {
    setError("");
    if (mode === "badge") {
      setBadge("");
      setPin("");
      setTimeout(() => badgeRef.current?.focus(), 0);
    }
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const res = await login({ email, password }).unwrap();
      dispatch(setCredentials(res));
      navigate("/");
    } catch (err) {
      setError(err?.data?.message || "Identifiants incorrects");
    }
  };

  const handleBadgeChange = (valeur) => {
    // La douchette tape des chiffres (parfois suivis d'un retour chariot) :
    // on ne garde que les chiffres, et à 13 on passe la main au PIN.
    const code = String(valeur || "").replace(/\D/g, "").slice(0, 13);
    setBadge(code);
    if (code.length === 13) pinRef.current?.focus();
  };

  const handleSubmitBadge = async (e) => {
    e.preventDefault();
    setError("");
    if (badge.length !== 13) {
      setError("Bipez votre badge (code de 13 chiffres).");
      badgeRef.current?.focus();
      return;
    }
    try {
      const res = await loginBadge({ codeBarre: badge, pin }).unwrap();
      dispatch(setCredentials(res));
      navigate("/");
    } catch (err) {
      setError(err?.data?.message || "Badge ou code PIN invalide");
      setPin("");
      // Après un échec, on repart du badge : l'erreur la plus courante au
      // poste partagé est « mauvais badge », pas « mauvais PIN ».
      setBadge("");
      badgeRef.current?.focus();
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>QC Tools</h1>
          <span>Connexion</span>
        </div>

        {/* Bascule e-mail / badge */}
        <div className="login-modes">
          <button
            type="button"
            className={`login-mode ${mode === "email" ? "active" : ""}`}
            onClick={() => setMode("email")}
          >
            E-mail
          </button>
          <button
            type="button"
            className={`login-mode ${mode === "badge" ? "active" : ""}`}
            onClick={() => setMode("badge")}
          >
            Badge
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        {mode === "email" ? (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="utilisateur@entreprise.com"
                required
              />
            </div>

            <div className="form-group">
              <label>Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <div className="forgot-link-wrap">
              <Link to="/forgot-password" className="forgot-link">
                Mot de passe oublié ?
              </Link>
            </div>

            <button type="submit" className="btn-login" disabled={isLoading}>
              {isLoading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmitBadge} className="login-form">
            <div className="form-group">
              <label>Badge</label>
              <input
                ref={badgeRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={badge}
                onChange={(e) => handleBadgeChange(e.target.value)}
                placeholder="Bipez votre badge…"
              />
            </div>

            <div className="form-group">
              <label>Code PIN</label>
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••"
              />
            </div>

            <p className="login-badge-hint">
              Bipez votre badge puis tapez votre code PIN. Pas de code PIN ?
              Définissez-le dans votre profil, ou demandez à un administrateur.
            </p>

            <button
              type="submit"
              className="btn-login"
              disabled={loadingBadge || badge.length !== 13 || pin.length < 4}
            >
              {loadingBadge ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        )}

        <div className="login-footer">
          <span>Contactez votre administrateur pour obtenir un accès</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
