package com.mora.dto;

import com.mora.entity.NotificationSetting;

public record NotificationSettingResponse(int deadlineReminderDays,
                                          boolean deadlineReminderEnabled,
                                          boolean scheduleReminderEnabled) {
    public static NotificationSettingResponse from(NotificationSetting s) {
        return new NotificationSettingResponse(s.getDeadlineReminderDays(),
                s.getDeadlineReminderEnabled(), s.getScheduleReminderEnabled());
    }
}
