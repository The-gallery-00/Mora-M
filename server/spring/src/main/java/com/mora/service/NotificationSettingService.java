package com.mora.service;

import com.mora.dto.NotificationSettingRequest;
import com.mora.dto.NotificationSettingResponse;
import com.mora.entity.NotificationSetting;
import com.mora.repository.NotificationSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

@Service
public class NotificationSettingService {
    public static final int MAX_DEADLINE_REMINDER_DAYS = 30;
    private final NotificationSettingRepository repository;
    public NotificationSettingService(NotificationSettingRepository repository) { this.repository = repository; }

    @Transactional
    public NotificationSetting findOrCreate(UUID userId) {
        return repository.findById(userId).orElseGet(() -> {
            NotificationSetting setting = new NotificationSetting();
            setting.setUserId(userId);
            return repository.save(setting);
        });
    }

    @Transactional
    public NotificationSettingResponse update(UUID userId, NotificationSettingRequest request) {
        NotificationSetting setting = findOrCreate(userId);
        if (request.getDeadlineReminderDays() != null) {
            int days = request.getDeadlineReminderDays();
            if (days < 0 || days > MAX_DEADLINE_REMINDER_DAYS) {
                throw new IllegalArgumentException("Reminder days must be between 0 and 30");
            }
            setting.setDeadlineReminderDays(days);
        }
        if (request.getDeadlineReminderEnabled() != null) setting.setDeadlineReminderEnabled(request.getDeadlineReminderEnabled());
        if (request.getScheduleReminderEnabled() != null) setting.setScheduleReminderEnabled(request.getScheduleReminderEnabled());
        return NotificationSettingResponse.from(repository.save(setting));
    }
}
