import { apiSlice } from "./apiSlice";
import { USERS_URL } from "../constants";

// URL de la photo de profil d'un user (cache-bustée par photoUpdatedAt).
export const userPhotoUrl = (id, v) =>
  `${USERS_URL}/${id}/photo${v ? `?v=${encodeURIComponent(v)}` : ""}`;

/**
 * URL du PDF des badges. Hors RTK Query : c'est un flux binaire qu'on ouvre
 * dans un onglet, pas une donnée à mettre en cache.
 *   format : "liste" (feuille de poste) | "cartes" (à découper)
 *   tri    : "nom" | "entreprise"  (sans effet sur les cartes)
 *   ids    : sélection ; vide = tout le périmètre géré
 */
export const badgesPdfUrl = ({ format = "liste", tri = "nom", ids = [] } = {}) => {
  const params = new URLSearchParams({ format, tri });
  if (ids.length) params.set("ids", ids.join(","));
  return `${USERS_URL}/badges/pdf?${params.toString()}`;
};

export const userApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Auth
    login: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/login`,
        method: "POST",
        body: data,
      }),
    }),
    logout: builder.mutation({
      query: () => ({
        url: `${USERS_URL}/logout`,
        method: "POST",
      }),
    }),

    // Mot de passe oublié / reset
    forgotPassword: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/forgot-password`,
        method: "POST",
        body: data,
      }),
    }),
    resetPassword: builder.mutation({
      query: ({ token, password }) => ({
        url: `${USERS_URL}/reset-password/${token}`,
        method: "PUT",
        body: { password },
      }),
    }),

    // Profile (utilisateur connecté)
    getProfile: builder.query({
      query: () => ({
        url: `${USERS_URL}/profile`,
      }),
      providesTags: ["User"],
    }),
    updateProfile: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/profile`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),
    uploadProfilePhoto: builder.mutation({
      query: (file) => {
        const fd = new FormData();
        fd.append("photo", file);
        return { url: `${USERS_URL}/profile/photo`, method: "POST", body: fd };
      },
      invalidatesTags: ["User"],
    }),
    deleteProfilePhoto: builder.mutation({
      query: () => ({ url: `${USERS_URL}/profile/photo`, method: "DELETE" }),
      invalidatesTags: ["User"],
    }),

    // Admin: Gestion des utilisateurs
    getUsers: builder.query({
      query: () => ({
        url: USERS_URL,
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),
    // ── Badges (code-barres utilisateurs) ────────────────────────────────
    // Rattrapage des comptes créés avant la fonctionnalité. Invalide "User" :
    // la liste doit réafficher les codes fraîchement attribués.
    genererBadgesManquants: builder.mutation({
      query: () => ({
        url: `${USERS_URL}/badges/generer`,
        method: "POST",
      }),
      invalidatesTags: ["User"],
    }),
    // Résolution d'un badge scanné → identité de la personne.
    getUserParBadge: builder.query({
      query: (code) => ({ url: `${USERS_URL}/badges/${encodeURIComponent(code)}` }),
    }),

    // Liste allégée des utilisateurs assignables à une équipe (périmètre société).
    getAssignableUsers: builder.query({
      query: () => ({
        url: `${USERS_URL}/assignable`,
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),
    // Annuaire société pour créer une discussion (tout utilisateur connecté).
    getDirectoryUsers: builder.query({
      query: () => ({
        url: `${USERS_URL}/directory`,
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 30,
    }),
    getUserById: builder.query({
      query: (id) => ({
        url: `${USERS_URL}/${id}`,
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),
    createUser: builder.mutation({
      query: (data) => ({
        url: USERS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),
    updateUser: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${USERS_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),
    deleteUser: builder.mutation({
      query: (id) => ({
        url: `${USERS_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["User"],
    }),
    toggleUserActive: builder.mutation({
      query: (id) => ({
        url: `${USERS_URL}/${id}/toggle-active`,
        method: "PATCH",
      }),
      invalidatesTags: ["User"],
    }),
  }),
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useGetProfileQuery,
  useUpdateProfileMutation,
  useUploadProfilePhotoMutation,
  useDeleteProfilePhotoMutation,
  useGetUsersQuery,
  useGenererBadgesManquantsMutation,
  useLazyGetUserParBadgeQuery,
  useGetAssignableUsersQuery,
  useGetDirectoryUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useToggleUserActiveMutation,
} = userApiSlice;