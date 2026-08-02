package com.mora.service;

import com.mora.dto.CalendarConnectionResponse;
import com.mora.dto.CalendarTokenResponse;
import com.mora.dto.GoogleCalendarMonthResponse;
import com.mora.entity.GoogleCalendarToken;
import com.mora.repository.GoogleCalendarTokenRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

@Service
public class GoogleCalendarService {

    private final GoogleCalendarTokenRepository tokenRepository;

    @Value("${app.calendar.google.client-id:}")
    private String clientId;

    @Value("${app.calendar.google.client-secret:}")
    private String clientSecret;

    @Value("${app.calendar.google.redirect-uri:}")
    private String redirectUri;

    public GoogleCalendarService(GoogleCalendarTokenRepository tokenRepository) {
        this.tokenRepository = tokenRepository;
    }

    public CalendarConnectionResponse connected(UUID userId) {
        return new CalendarConnectionResponse(userId, tokenRepository.existsById(userId));
    }

    public CalendarTokenResponse tokenInfo(UUID userId) {
        GoogleCalendarToken token = tokenRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("구글 캘린더 연동 정보가 없습니다."));
        return CalendarTokenResponse.from(token);
    }

    public Map<String, String> connectUrl(UUID userId) {
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()
                || redirectUri == null || redirectUri.isBlank()) {
            throw new RuntimeException("Google Calendar OAuth is not configured");
        }
        throw new RuntimeException("Google Calendar OAuth callback is not implemented yet");
    }

    public CalendarConnectionResponse disconnect(UUID userId) {
        if (!tokenRepository.existsById(userId)) {
            throw new RuntimeException("구글 캘린더 연동 정보가 없습니다.");
        }
        tokenRepository.deleteById(userId);
        return new CalendarConnectionResponse(userId, false);
    }

    public GoogleCalendarMonthResponse month(UUID userId, int year, int month) {
        return new GoogleCalendarMonthResponse(userId, year, month, tokenRepository.existsById(userId));
    }
}
