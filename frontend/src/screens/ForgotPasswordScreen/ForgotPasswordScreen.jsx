// src/screens/ForgotPasswordScreen/ForgotPasswordScreen.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useForgotPasswordMutation } from "../../slices/userApiSlice";
import "./ForgotPasswordScreen.css";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await forgotPassword({ email }).unwrap();
      setSuccess(true);
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  return (
    <div className="forgot-container">
      <div className="forgot-box">
        <div className="forgot-header">
          <div className="forgot-icon">🔐</div>
          <h1>QC Tools</h1>
          <span>Mot de passe oublié</span>
        </div>

        {success ? (
          <div className="forgot-success">
            <span className="forgot-success-icon">✅</span>
            <p>
              Si cet email existe dans notre système, un lien de
              réinitialisation vous a été envoyé.
            </p>
            <p className="forgot-success-sub">
              Pensez à vérifier vos spams.
            </p>
            <Link to="/login" className="btn-back">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <>
            <p className="forgot-desc">
              Entrez votre adresse email et nous vous enverrons un lien pour
              réinitialiser votre mot de passe.
            </p>

            {error && <div className="forgot-error">{error}</div>}

            <form onSubmit={handleSubmit} className="forgot-form">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                className="btn-submit"
                disabled={isLoading}
              >
                {isLoading ? "Envoi en cours..." : "Envoyer le lien"}
              </button>
            </form>

            <div className="forgot-footer">
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

export default ForgotPassword;