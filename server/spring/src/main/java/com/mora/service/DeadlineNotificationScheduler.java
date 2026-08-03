package com.mora.service;

import com.mora.entity.*;
import com.mora.repository.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class DeadlineNotificationScheduler {
    private final UserRepository users;
    private final TicketRepository tickets;
    private final PosterRepository posters;
    private final NotificationRepository notifications;
    private final NotificationSettingService settings;

    public DeadlineNotificationScheduler(UserRepository users, TicketRepository tickets,
            PosterRepository posters, NotificationRepository notifications,
            NotificationSettingService settings) {
        this.users = users; this.tickets = tickets; this.posters = posters;
        this.notifications = notifications; this.settings = settings;
    }

    @Scheduled(cron = "0 0 9 * * *", zone = "Asia/Seoul")
    @Transactional
    public void createDailyNotifications() {
        LocalDate today = LocalDate.now();
        users.findAll().forEach(user -> createForUser(user.getId(), today));
    }

    void createForUser(UUID userId, LocalDate today) {
        NotificationSetting setting = settings.findOrCreate(userId);
        int days = setting.getDeadlineReminderDays();
        LocalDate end = today.plusDays(days);
        if (setting.getDeadlineReminderEnabled()) {
            tickets.findByUserIdAndDepartureDateBetweenOrderByDepartureDateAscDepartureTimeAsc(userId, today, end)
                    .forEach(t -> create(userId, "DEADLINE", "TICKET", String.valueOf(t.getId()),
                            t.getDepartureDate(), "일정 임박", ticketTitle(t) + " 일정이 " + dDay(today, t.getDepartureDate()),
                            "/dashboard/storage/tickets"));
            posters.findByUserIdAndEventStartDateBetweenOrderByEventStartDateAsc(userId, today, end)
                    .forEach(p -> create(userId, "DEADLINE", "POSTER", String.valueOf(p.getId()),
                            p.getEventStartDate(), "마감 임박", value(p.getTitle()) + " 마감이 " + dDay(today, p.getEventStartDate()),
                            "/dashboard/storage/posters"));
        }
        if (setting.getScheduleReminderEnabled()) {
            tickets.findByUserIdAndDepartureDateOrderByDepartureTimeAsc(userId, today)
                    .forEach(t -> create(userId, "SCHEDULE", "TICKET", String.valueOf(t.getId()), today,
                            "오늘 일정", ticketTitle(t) + " 일정이 오늘입니다.", "/dashboard/storage/tickets"));
            posters.findByUserIdAndEventStartDateOrderByCreatedAtAsc(userId, today)
                    .forEach(p -> create(userId, "SCHEDULE", "POSTER", String.valueOf(p.getId()), today,
                            "오늘 일정", value(p.getTitle()) + " 일정이 오늘입니다.", "/dashboard/storage/posters"));
        }
    }

    private void create(UUID userId, String type, String sourceType, String sourceId,
                        LocalDate targetDate, String title, String message, String linkUrl) {
        if (notifications.existsByUserIdAndTypeAndSourceTypeAndSourceIdAndTargetDate(
                userId, type, sourceType, sourceId, targetDate)) return;
        Notification n = new Notification();
        n.setUserId(userId); n.setType(type); n.setSourceType(sourceType); n.setSourceId(sourceId);
        n.setTargetDate(targetDate); n.setTitle(title); n.setMessage(message); n.setLinkUrl(linkUrl);
        notifications.save(n);
    }

    private static String dDay(LocalDate today, LocalDate target) {
        long days = ChronoUnit.DAYS.between(today, target);
        return days == 0 ? "오늘입니다." : days + "일 남았습니다.";
    }
    private static String ticketTitle(Ticket t) { return value(t.getDepartureLocation()) + " → " + value(t.getArrivalLocation()); }
    private static String value(String value) { return value == null ? "" : value; }
}
