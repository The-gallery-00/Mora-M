package com.mora.repository;

import com.mora.entity.NotificationSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface NotificationSettingRepository extends JpaRepository<NotificationSetting, UUID> {}
