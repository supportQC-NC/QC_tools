// src/screens/ResetPasswordScreen/ResetPasswordScreen.jsx
import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useResetPasswordMutation } from "../../slices/userApiSlice";
import "./ResetPasswordScreen.css";

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [resetPassword, { isLoading }] = useResetPasswordMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      return setError("Le mot de passe doit contenir au moins 6 caractères");
    }
    if (password !== confirm) {
      return setError("Les mots de passe ne correspondent pas");
    }

    try {
      await resetPassword({ token, password }).unwrap();
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err?.data?.message || "Token invalide ou expiré");
    }
  };

  return (
    <div className="reset-container">
      <div className="reset-box">
        <div className="reset-header">
          <div className="reset-icon">🔑</div>
          <h1>QC Tools</h1>
          <span>Nouveau mot de passe</span>
        </div>

        {success ? (
          <div className="reset-success">
            <span className="reset-success-icon">✅</span>
            <p>Mot de passe réinitialisé avec succès !</p>
            <p className="reset-redirect">
              Redirection vers la connexion dans 3 secondes...
            </p>
          </div>
        ) : (
          <>
            {error && <div className="reset-error">{error}</div>}

            <form onSubmit={handleSubmit} className="reset-form">
              <div className="form-group">
                <label>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <div className="password-rules">
                <span className={password.length >= 6 ? "rule valid" : "rule"}>
                  {password.length >= 6 ? "✓" : "○"} Au moins 6 caractères
                </span>
                <span
                  className={
                    password && password === confirm ? "rule valid" : "rule"
                  }
                >
                  {password && password === confirm ? "✓" : "○"} Les mots de
                  passe correspondent
                </span>
              </div>

              <button
                type="submit"
                className="btn-submit"
                disabled={isLoading}
              >
                {isLoading ? "Réinitialisation..." : "Confirmer"}
              </button>
            </form>

            <div className="reset-footer">
              <Link to="/login" className="back-link">
                ← Retour à la connexion
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;