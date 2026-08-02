package com.mora.dto;

import com.mora.entity.GoogleCalendarToken;

import java.time.LocalDateTime;
import java.util.UUID;

public class CalendarTokenResponse {
    private UUID userId;
    private String googleEmail;
    private String scope;
    private LocalDateTime expiresAt;
    private boolean connected;

    public static CalendarTokenResponse from(GoogleCalendarToken token) {
        CalendarTokenResponse response = new CalendarTokenResponse();
        response.setUserId(token.getUserId());
        response.setGoogleEmail(token.getGoogleEmail());
        response.setScope(token.getScope());
        response.setExpiresAt(token.getExpiresAt());
        response.setConnected(true);
        return response;
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public String getGoogleEmail() {
        return googleEmail;
    }

    public void setGoogleEmail(String googleEmail) {
        this.googleEmail = googleEmail;
    }

    public String getScope() {
        return scope;
    }

    public void setScope(String scope) {
        this.scope = scope;
    }

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
    }

    public boolean isConnected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }
}
