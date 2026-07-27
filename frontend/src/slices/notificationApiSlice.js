// src/slices/notificationApiSlice.js
//
// Compteurs de notifications pour la sidebar (« Espace équipe » + « Mes tâches »).
// La query se rafraîchit toute seule (polling) ET peut être invalidée à la volée
// par le socket (voir useNotificationsSync) pour un ressenti temps réel.
import { apiSlice } from "./apiSlice";
import { NOTIFICATIONS_URL } from "../constants";

export const notificationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getNotificationCounts: builder.query({
      query: () => ({ url: `${NOTIFICATIONS_URL}/counts` }),
      providesTags: ["Notif"],
    }),
    // Marque les messages du chat comme lus (ouverture de « Espace équipe »).
    markChatSeen: builder.mutation({
      query: () => ({ url: `${NOTIFICATIONS_URL}/chat/seen`, method: "POST" }),
      invalidatesTags: ["Notif"],
    }),
    // Marque les tâches comme vues (ouverture de « Mes tâches »).
    markTasksSeen: builder.mutation({
      query: () => ({ url: `${NOTIFICATIONS_URL}/tasks/seen`, method: "POST" }),
      invalidatesTags: ["Notif"],
    }),
  }),
});

export const {
  useGetNotificationCountsQuery,
  useMarkChatSeenMutation,
  useMarkTasksSeenMutation,
} = notificationApiSlice;
