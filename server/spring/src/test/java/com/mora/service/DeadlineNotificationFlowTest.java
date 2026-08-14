package com.mora.service;

import com.mora.entity.NotificationSetting;
import com.mora.repository.NotificationRepository;
import com.mora.repository.PosterRepository;
import com.mora.repository.TicketRepository;
import com.mora.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DeadlineNotificationFlowTest {

    @Test
    void notificationQueriesReconcileCurrentUserBeforeReading() {
        NotificationRepository repository = mock(NotificationRepository.class);
        DeadlineNotificationScheduler scheduler = mock(DeadlineNotificationScheduler.class);
        NotificationService service = new NotificationService(repository, scheduler);
        UUID userId = UUID.randomUUID();

        when(repository.findByUserIdOrderByCreatedAtDesc(eq(userId), any(Pageable.class)))
                .thenReturn(Page.empty());

        service.list(userId, 0, 20);
        service.unreadCount(userId);

        verify(scheduler, org.mockito.Mockito.times(2)).createForUserNow(userId);
        verify(repository).countByUserIdAndReadAtIsNull(userId);
    }

    @Test
    void onDemandGenerationUsesSeoulDateWindow() {
        UserRepository users = mock(UserRepository.class);
        TicketRepository tickets = mock(TicketRepository.class);
        PosterRepository posters = mock(PosterRepository.class);
        NotificationRepository notifications = mock(NotificationRepository.class);
        NotificationSettingService settings = mock(NotificationSettingService.class);
        DeadlineNotificationScheduler scheduler = new DeadlineNotificationScheduler(
                users, tickets, posters, notifications, settings);
        UUID userId = UUID.randomUUID();
        NotificationSetting setting = new NotificationSetting();
        setting.setUserId(userId);
        setting.setDeadlineReminderDays(3);
        setting.setDeadlineReminderEnabled(true);
        setting.setScheduleReminderEnabled(true);
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));

        when(settings.findOrCreate(userId)).thenReturn(setting);
        when(tickets.findByUserIdAndDepartureDateBetweenOrderByDepartureDateAscDepartureTimeAsc(
                userId, today, today.plusDays(3))).thenReturn(List.of());
        when(posters.findByUserIdAndEventStartDateBetweenOrderByEventStartDateAsc(
                userId, today, today.plusDays(3))).thenReturn(List.of());
        when(tickets.findOngoingEndingBetween(userId, today, today.plusDays(3)))
                .thenReturn(List.of());
        when(posters.findOngoingEndingBetween(userId, today, today.plusDays(3)))
                .thenReturn(List.of());

        scheduler.createForUserNow(userId);

        verify(tickets).findByUserIdAndDepartureDateBetweenOrderByDepartureDateAscDepartureTimeAsc(
                userId, today, today.plusDays(3));
        verify(posters).findByUserIdAndEventStartDateBetweenOrderByEventStartDateAsc(
                userId, today, today.plusDays(3));
        verify(tickets).findOngoingEndingBetween(userId, today, today.plusDays(3));
        verify(posters).findOngoingEndingBetween(userId, today, today.plusDays(3));
    }
}
