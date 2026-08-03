package com.mora.dto;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

public record DashboardResponse(LocalDate date, int deadlineDays, long todayScheduleCount,
                                long upcomingDeadlineCount, long storedDocumentCount,
                                List<DeadlineItem> upcomingDeadlines,
                                List<ScheduleItem> todaySchedules) {
    public record DeadlineItem(String type, String id, String title, String subtitle,
                               LocalDate date, long dDay, String imageUrl) {}
    public record ScheduleItem(String type, String id, String title, LocalTime time, LocalDate date) {}
}
