package com.mora.dto;

// API-62 응답. 캘린더는 매핑 엔티티가 없어 항상 0
public record UserDataDeleteResponse(
        long deletedBusinessCards,
        long deletedTickets,
        long deletedPosters,
        long deletedReceipts,
        long deletedSearchHistories,
        long deletedGoogleCalendarMappings,
        long deletedNotifications
) {
}
