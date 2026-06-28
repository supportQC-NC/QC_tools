
// backend/controllers/userControlleur.js
import asyncHandler from "../middleware/asyncHandler.js";
import User from "../models/UserModel.js";
import Permission from "../models/PermissionModel.js";
import generateToken from "../utils/generateToken.js";
import sendEmail from "../utils/sendEmail.js";
import crypto from "crypto";

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");

  if (!user || !user.isActive) {
    res.status(401);
    throw new Error("Email ou mot de passe invalide");
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    res.status(401);
    throw new Error("Email ou mot de passe invalide");
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const permissions = await Permission.findOne({ user: user._id }).populate(
    "entreprises",
    "nomDossierDBF trigramme nomComplet",
  );

  generateToken(res, user._id);

  res.json({
    _id: user._id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    role: user.role,
    permissions: permissions || null,
  });
});

// @desc    Logout user / clear cookie
// @route   POST /api/users/logout
// @access  Private
const logoutUser = asyncHandler(async (req, res) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({ message: "Déconnexion réussie" });
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const permissions = await Permission.findOne({ user: req.user._id }).populate(
    "entreprises",
    "nomDossierDBF trigramme nomComplet",
  );

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  res.json({
    _id: user._id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    permissions: permissions || null,
  });
});

// @desc    Update user profile (self)
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  user.nom = req.body.nom || user.nom;
  user.prenom = req.body.prenom || user.prenom;
  user.email = req.body.email || user.email;

  if (req.body.password) {
    user.password = req.body.password;
  }

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    email: updatedUser.email,
    nom: updatedUser.nom,
    prenom: updatedUser.prenom,
    role: updatedUser.role,
  });
});

// @desc    Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.json({
      message:
        "Si cet email existe, un lien de réinitialisation a été envoyé.",
    });
  }

  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      email: user.email,
      subject: "🔐 Réinitialisation de votre mot de passe",
      html: generateResetEmail({
        prenom: user.prenom,
        nom: user.nom,
        resetUrl,
      }),
    });

    res.json({
      message:
        "Si cet email existe, un lien de réinitialisation a été envoyé.",
    });
  } catch (error) {
    user.resetPasswordToken = null;
    user.resetPasswordExpire = null;
    await user.save({ validateBeforeSave: false });

    res.status(500);
    throw new Error("Erreur lors de l'envoi de l'email, réessayez plus tard.");
  }
});

// @desc    Reset password via token
// @route   PUT /api/users/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    res.status(400);
    throw new Error("Token invalide ou expiré");
  }

  user.password = req.body.password;
  user.resetPasswordToken = null;
  user.resetPasswordExpire = null;
  await user.save();

  res.json({ message: "Mot de passe réinitialisé avec succès" });
});

// =============================================
// ADMIN ONLY
// =============================================

// @desc    Create new user (Admin only)
// @route   POST /api/users
// @access  Private/Admin
const createUser = asyncHandler(async (req, res) => {
  const { email, password, nom, prenom, role, permissions } = req.body;

  const userExists = await User.findOne({ email });

  if (userExists) {
    res.status(400);
    throw new Error("Cet email est déjà utilisé");
  }

  const user = await User.create({
    email,
    password,
    nom,
    prenom,
    role: role || "user",
    createdBy: req.user._id,
  });

  if (permissions) {
    await Permission.create({
      user: user._id,
      entreprises: permissions.entreprises || [],
      modules: permissions.modules || {},
      allEntreprises: permissions.allEntreprises || false,
      allModules: permissions.allModules || false,
    });
  } else {
    await Permission.create({
      user: user._id,
      entreprises: [],
      modules: {
        clients: { read: false, write: false, delete: false },
        factures: { read: false, write: false, delete: false },
        rapports: { read: false, write: false, delete: false },
        stock: { read: false, write: false, delete: false },
        parametres: { read: false, write: false, delete: false },
      },
      allEntreprises: false,
      allModules: false,
    });
  }

  try {
    await sendEmail({
      email: user.email,
      subject: "✦ Votre compte a été créé",
      html: generateWelcomeEmail({
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        password,
        role: user.role,
      }),
    });
  } catch (error) {
    console.error("Erreur envoi email de bienvenue:", error.message);
  }

  const userPermissions = await Permission.findOne({ user: user._id }).populate(
    "entreprises",
    "nomDossierDBF trigramme nomComplet",
  );

  res.status(201).json({
    _id: user._id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    role: user.role,
    isActive: user.isActive,
    permissions: userPermissions,
  });
});

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({})
    .select("-password")
    .populate("createdBy", "nom prenom email")
    .sort({ createdAt: -1 });

  const usersWithPermissions = await Promise.all(
    users.map(async (user) => {
      const permissions = await Permission.findOne({ user: user._id }).populate(
        "entreprises",
        "nomDossierDBF trigramme nomComplet",
      );
      return {
        ...user.toObject(),
        permissions: permissions || null,
      };
    }),
  );

  res.json(usersWithPermissions);
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private/Admin
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select("-password")
    .populate("createdBy", "nom prenom email");

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  const permissions = await Permission.findOne({ user: user._id }).populate(
    "entreprises",
    "nomDossierDBF trigramme nomComplet",
  );

  res.json({
    ...user.toObject(),
    permissions: permissions || null,
  });
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  user.nom = req.body.nom || user.nom;
  user.prenom = req.body.prenom || user.prenom;
  user.email = req.body.email || user.email;
  user.role = req.body.role || user.role;
  user.isActive = req.body.isActive ?? user.isActive;

  if (req.body.password) {
    user.password = req.body.password;
  }

  const updatedUser = await user.save();

  if (req.body.permissions) {
    await Permission.findOneAndUpdate(
      { user: user._id },
      {
        entreprises: req.body.permissions.entreprises || [],
        modules: req.body.permissions.modules,
        allEntreprises: req.body.permissions.allEntreprises,
        allModules: req.body.permissions.allModules,
      },
      { new: true, upsert: true },
    );
  }

  const permissions = await Permission.findOne({ user: user._id }).populate(
    "entreprises",
    "nomDossierDBF trigramme nomComplet",
  );

  res.json({
    _id: updatedUser._id,
    email: updatedUser.email,
    nom: updatedUser.nom,
    prenom: updatedUser.prenom,
    role: updatedUser.role,
    isActive: updatedUser.isActive,
    permissions: permissions || null,
  });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  if (
    user.role === "admin" &&
    req.user._id.toString() !== user._id.toString()
  ) {
    res.status(400);
    throw new Error("Impossible de supprimer un autre administrateur");
  }

  await Permission.deleteOne({ user: user._id });
  await User.deleteOne({ _id: user._id });

  res.json({ message: "Utilisateur supprimé" });
});

// @desc    Toggle user active status
// @route   PATCH /api/users/:id/toggle-active
// @access  Private/Admin
const toggleUserActive = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("Utilisateur non trouvé");
  }

  user.isActive = !user.isActive;
  await user.save();

  res.json({
    _id: user._id,
    isActive: user.isActive,
    message: user.isActive ? "Utilisateur activé" : "Utilisateur désactivé",
  });
});

// =============================================
// EMAIL TEMPLATES
// =============================================

const generateWelcomeEmail = ({ nom, prenom, email, password, role }) => `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Bienvenue</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #080810; font-family: 'DM Sans', sans-serif; color: #e2e8f0; padding: 48px 16px; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 580px; margin: 0 auto; }
    .pre-header { text-align: center; margin-bottom: 24px; }
    .pre-header span { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #4a5568; font-family: 'Syne', sans-serif; font-weight: 600; }
    .header { background: linear-gradient(160deg, #0f0f23 0%, #131330 40%, #0f1f40 100%); border-radius: 24px 24px 0 0; padding: 56px 48px 48px; text-align: center; position: relative; overflow: hidden; border: 1px solid #1e2035; border-bottom: none; }
    .header-glow-1 { position: absolute; top: -80px; right: -80px; width: 280px; height: 280px; background: radial-gradient(circle, rgba(99,179,237,0.12) 0%, transparent 65%); border-radius: 50%; pointer-events: none; }
    .header-glow-2 { position: absolute; bottom: -60px; left: -60px; width: 220px; height: 220px; background: radial-gradient(circle, rgba(167,139,250,0.10) 0%, transparent 65%); border-radius: 50%; pointer-events: none; }
    .logo-wrap { position: relative; z-index: 1; margin-bottom: 28px; }
    .logo-outer { display: inline-block; padding: 3px; border-radius: 20px; background: linear-gradient(135deg, #63b3ed, #a78bfa, #ed64a6); }
    .logo-inner { display: inline-flex; align-items: center; justify-content: center; width: 68px; height: 68px; background: #0f0f23; border-radius: 18px; font-family: 'Syne', sans-serif; font-size: 30px; font-weight: 800; color: #fff; }
    .header-tag { display: inline-block; background: rgba(99,179,237,0.1); border: 1px solid rgba(99,179,237,0.25); color: #63b3ed; font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; padding: 5px 14px; border-radius: 20px; margin-bottom: 16px; position: relative; z-index: 1; }
    .header h1 { font-family: 'Syne', sans-serif; font-size: 30px; font-weight: 800; color: #ffffff; letter-spacing: -1px; line-height: 1.2; position: relative; z-index: 1; }
    .header h1 span { background: linear-gradient(90deg, #63b3ed, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .header-sub { font-size: 14px; color: #718096; margin-top: 10px; font-weight: 300; position: relative; z-index: 1; line-height: 1.6; }
    .divider-bar { height: 1px; background: linear-gradient(90deg, transparent, #63b3ed 30%, #a78bfa 70%, transparent); opacity: 0.4; }
    .body { background: #0c0c18; padding: 44px 48px; border: 1px solid #1e2035; border-top: none; border-bottom: none; }
    .greeting { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 700; color: #ffffff; margin-bottom: 14px; }
    .intro { font-size: 14px; color: #718096; line-height: 1.8; margin-bottom: 36px; }
    .section-label { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .section-label span { font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #4a5568; }
    .section-label::after { content: ''; flex: 1; height: 1px; background: #1e2035; }
    .card { background: #0f0f1e; border: 1px solid #1e2035; border-radius: 20px; overflow: hidden; margin-bottom: 24px; }
    .card-header { padding: 18px 24px; background: linear-gradient(90deg, rgba(99,179,237,0.06), rgba(167,139,250,0.06)); border-bottom: 1px solid #1e2035; display: flex; align-items: center; gap: 10px; }
    .card-header-dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #63b3ed, #a78bfa); }
    .card-header span { font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 1px; color: #a0aec0; text-transform: uppercase; }
    .credential-row { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; border-bottom: 1px solid #13131f; gap: 16px; }
    .credential-row:last-child { border-bottom: none; }
    .cred-left { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    .cred-icon-wrap { width: 34px; height: 34px; border-radius: 10px; background: #131325; border: 1px solid #1e2035; display: flex; align-items: center; justify-content: center; font-size: 15px; }
    .cred-label { font-size: 12px; color: #4a5568; font-weight: 500; }
    .cred-value { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 600; color: #cbd5e0; text-align: right; word-break: break-all; }
    .cred-value.password-val { font-family: 'Courier New', monospace; background: linear-gradient(135deg, rgba(237,100,166,0.1), rgba(167,139,250,0.1)); border: 1px solid rgba(237,100,166,0.2); padding: 8px 14px; border-radius: 10px; font-size: 15px; color: #f9a8d4; letter-spacing: 2px; font-weight: 700; }
    .role-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; font-family: 'Syne', sans-serif; letter-spacing: 0.5px; }
    .role-dot { width: 6px; height: 6px; border-radius: 50%; }
    .role-admin { background: rgba(237,100,166,0.12); color: #f9a8d4; border: 1px solid rgba(237,100,166,0.25); }
    .role-admin .role-dot { background: #ed64a6; }
    .role-user { background: rgba(99,179,237,0.12); color: #90cdf4; border: 1px solid rgba(99,179,237,0.25); }
    .role-user .role-dot { background: #63b3ed; }
    .warning { display: flex; gap: 14px; align-items: flex-start; background: linear-gradient(135deg, rgba(251,191,36,0.05), rgba(245,158,11,0.08)); border: 1px solid rgba(251,191,36,0.18); border-radius: 16px; padding: 18px 20px; margin-bottom: 32px; }
    .warning-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
    .warning-content p { font-size: 13px; color: #fbbf24; line-height: 1.7; }
    .warning-content strong { font-weight: 600; color: #fcd34d; }
    .btn-wrap { text-align: center; margin-bottom: 8px; }
    .btn-outer { display: inline-block; padding: 2px; border-radius: 14px; background: linear-gradient(135deg, #63b3ed, #a78bfa, #ed64a6); }
    .btn { display: inline-block; background: #0c0c18; color: #ffffff !important; text-decoration: none; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; padding: 16px 44px; border-radius: 12px; letter-spacing: 0.3px; }
    .footer { background: #080810; border: 1px solid #1e2035; border-top: none; border-radius: 0 0 24px 24px; padding: 32px 48px; text-align: center; }
    .footer-divider { height: 1px; background: #13131f; margin-bottom: 24px; }
    .footer-logo { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800; color: #2d3748; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
    .footer p { font-size: 12px; color: #2d3748; line-height: 1.8; }
    .footer strong { color: #4a5568; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="pre-header"><span>Notification de création de compte</span></div>
    <div class="header">
      <div class="header-glow-1"></div>
      <div class="header-glow-2"></div>
      <div class="logo-wrap">
        <div class="logo-outer"><div class="logo-inner">K</div></div>
      </div>
      <div class="header-tag">Nouveau compte</div>
      <h1>Bienvenue sur la<br/><span>plateforme</span></h1>
      <p class="header-sub">Un administrateur vient de créer votre accès.<br/>Vos identifiants sont disponibles ci-dessous.</p>
    </div>
    <div class="divider-bar"></div>
    <div class="body">
      <p class="greeting">Bonjour ${prenom} ${nom} 👋</p>
      <p class="intro">Votre compte a été configuré avec succès. Vous pouvez dès maintenant accéder à la plateforme en utilisant les identifiants ci-dessous. Pour votre sécurité, nous vous conseillons de modifier votre mot de passe lors de votre première connexion.</p>
      <div class="section-label"><span>Vos identifiants de connexion</span></div>
      <div class="card">
        <div class="card-header"><div class="card-header-dot"></div><span>Informations du compte</span></div>
        <div class="credential-row">
          <div class="cred-left"><div class="cred-icon-wrap">👤</div><span class="cred-label">Nom complet</span></div>
          <span class="cred-value">${prenom} ${nom}</span>
        </div>
        <div class="credential-row">
          <div class="cred-left"><div class="cred-icon-wrap">✉️</div><span class="cred-label">Adresse email</span></div>
          <span class="cred-value">${email}</span>
        </div>
        <div class="credential-row">
          <div class="cred-left"><div class="cred-icon-wrap">🔑</div><span class="cred-label">Mot de passe</span></div>
          <span class="cred-value password-val">${password}</span>
        </div>
        <div class="credential-row">
          <div class="cred-left"><div class="cred-icon-wrap">🛡️</div><span class="cred-label">Rôle attribué</span></div>
          <span class="role-badge ${role === "admin" ? "role-admin" : "role-user"}">
            <span class="role-dot"></span>
            ${role === "admin" ? "Administrateur" : "Utilisateur"}
          </span>
        </div>
      </div>
      <div class="warning">
        <span class="warning-icon">⚠️</span>
        <div class="warning-content">
          <p><strong>Changez votre mot de passe</strong> dès votre première connexion. Ne partagez jamais ces informations avec qui que ce soit.</p>
        </div>
      </div>
      <div class="btn-wrap">
        <div class="btn-outer">
          <a href="http://192.168.0.86:3000" class="btn">Accéder à la plateforme →</a>
        
        </div>
      </div>
    </div>
    <div class="footer">
      <div class="footer-divider"></div>
      <div class="footer-logo">${process.env.SMTP_FROM_NAME || "Krysto"}</div>
      <p>Cet email a été envoyé automatiquement suite à la création de votre compte.<br/><strong>Ne répondez pas à cet email.</strong></p>
    </div>
  </div>
</body>
</html>
`;

const generateResetEmail = ({ prenom, nom, resetUrl }) => `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Réinitialisation mot de passe</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #080810; font-family: 'DM Sans', sans-serif; color: #e2e8f0; padding: 48px 16px; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 580px; margin: 0 auto; }
    .pre-header { text-align: center; margin-bottom: 24px; }
    .pre-header span { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #4a5568; font-family: 'Syne', sans-serif; font-weight: 600; }
    .header { background: linear-gradient(160deg, #1a0f0f 0%, #2d1515 40%, #1a0f20 100%); border-radius: 24px 24px 0 0; padding: 56px 48px 48px; text-align: center; position: relative; overflow: hidden; border: 1px solid #2d1e2e; border-bottom: none; }
    .header-glow { position: absolute; top: -60px; left: 50%; transform: translateX(-50%); width: 300px; height: 200px; background: radial-gradient(ellipse, rgba(237,100,166,0.15) 0%, transparent 65%); pointer-events: none; }
    .logo-wrap { position: relative; z-index: 1; margin-bottom: 28px; }
    .logo-outer { display: inline-block; padding: 3px; border-radius: 20px; background: linear-gradient(135deg, #f97316, #ed64a6); }
    .logo-inner { display: inline-flex; align-items: center; justify-content: center; width: 68px; height: 68px; background: #1a0f0f; border-radius: 18px; font-size: 32px; }
    .header-tag { display: inline-block; background: rgba(237,100,166,0.1); border: 1px solid rgba(237,100,166,0.25); color: #ed64a6; font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; padding: 5px 14px; border-radius: 20px; margin-bottom: 16px; position: relative; z-index: 1; }
    .header h1 { font-family: 'Syne', sans-serif; font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -1px; line-height: 1.2; position: relative; z-index: 1; }
    .header h1 span { background: linear-gradient(90deg, #f97316, #ed64a6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .header-sub { font-size: 14px; color: #718096; margin-top: 10px; font-weight: 300; position: relative; z-index: 1; line-height: 1.6; }
    .divider-bar { height: 1px; background: linear-gradient(90deg, transparent, #f97316 30%, #ed64a6 70%, transparent); opacity: 0.4; }
    .body { background: #0c0c18; padding: 44px 48px; border: 1px solid #2d1e2e; border-top: none; border-bottom: none; }
    .greeting { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 700; color: #ffffff; margin-bottom: 14px; }
    .intro { font-size: 14px; color: #718096; line-height: 1.8; margin-bottom: 36px; }
    .info-box { background: rgba(237,100,166,0.05); border: 1px solid rgba(237,100,166,0.15); border-radius: 16px; padding: 20px 24px; margin-bottom: 32px; display: flex; gap: 14px; align-items: flex-start; }
    .info-icon { font-size: 22px; flex-shrink: 0; }
    .info-text { font-size: 13px; color: #a0aec0; line-height: 1.7; }
    .info-text strong { color: #ed64a6; font-weight: 600; }
    .btn-wrap { text-align: center; margin-bottom: 28px; }
    .btn-outer { display: inline-block; padding: 2px; border-radius: 14px; background: linear-gradient(135deg, #f97316, #ed64a6); }
    .btn { display: inline-block; background: #0c0c18; color: #ffffff !important; text-decoration: none; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; padding: 16px 44px; border-radius: 12px; letter-spacing: 0.3px; }
    .link-fallback { text-align: center; margin-bottom: 8px; }
    .link-fallback p { font-size: 11px; color: #4a5568; margin-bottom: 8px; }
    .link-fallback a { font-size: 11px; color: #718096; word-break: break-all; text-decoration: underline; }
    .warning { display: flex; gap: 12px; align-items: flex-start; background: rgba(251,191,36,0.05); border: 1px solid rgba(251,191,36,0.15); border-radius: 12px; padding: 16px; margin-top: 24px; }
    .warning-icon { font-size: 16px; flex-shrink: 0; }
    .warning p { font-size: 12px; color: #92400e; line-height: 1.6; }
    .footer { background: #080810; border: 1px solid #2d1e2e; border-top: none; border-radius: 0 0 24px 24px; padding: 32px 48px; text-align: center; }
    .footer-divider { height: 1px; background: #13131f; margin-bottom: 24px; }
    .footer-logo { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800; color: #2d3748; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; }
    .footer p { font-size: 12px; color: #2d3748; line-height: 1.8; }
    .footer strong { color: #4a5568; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="pre-header"><span>Sécurité du compte</span></div>
    <div class="header">
      <div class="header-glow"></div>
      <div class="logo-wrap">
        <div class="logo-outer"><div class="logo-inner">🔐</div></div>
      </div>
      <div class="header-tag">Réinitialisation</div>
      <h1>Nouveau<br/><span>mot de passe</span></h1>
      <p class="header-sub">Une demande de réinitialisation a été effectuée.<br/>Le lien est valable <strong style="color:#ed64a6">30 minutes</strong>.</p>
    </div>
    <div class="divider-bar"></div>
    <div class="body">
      <p class="greeting">Bonjour ${prenom} ${nom} 👋</p>
      <p class="intro">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en définir un nouveau. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      <div class="info-box">
        <span class="info-icon">⏱️</span>
        <div class="info-text">Ce lien est <strong>valable 30 minutes</strong> seulement. Passé ce délai, vous devrez faire une nouvelle demande depuis la page de connexion.</div>
      </div>
      <div class="btn-wrap">
        <div class="btn-outer">
          <a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe →</a>
        </div>
      </div>
      <div class="link-fallback">
        <p>Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
        <a href="${resetUrl}">${resetUrl}</a>
      </div>
      <div class="warning">
        <span class="warning-icon">⚠️</span>
        <p>Si vous n'avez pas demandé cette réinitialisation, contactez immédiatement votre administrateur.</p>
      </div>
    </div>
    <div class="footer">
      <div class="footer-divider"></div>
      <div class="footer-logo">${process.env.SMTP_FROM_NAME || "Krysto"}</div>
      <p>Cet email a été envoyé automatiquement.<br/><strong>Ne répondez pas à cet email.</strong></p>
    </div>
  </div>
</body>
</html>
`;

export {
  authUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserActive,
};