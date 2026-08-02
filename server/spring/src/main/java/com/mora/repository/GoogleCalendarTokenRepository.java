package com.mora.repository;

import com.mora.entity.GoogleCalendarToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface GoogleCalendarTokenRepository extends JpaRepository<GoogleCalendarToken, UUID> {
}
