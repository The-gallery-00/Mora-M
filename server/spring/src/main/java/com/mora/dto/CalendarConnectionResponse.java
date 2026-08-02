package com.mora.dto;

import java.util.UUID;

public class CalendarConnectionResponse {
    private UUID userId;
    private boolean connected;

    public CalendarConnectionResponse(UUID userId, boolean connected) {
        this.userId = userId;
        this.connected = connected;
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public boolean isConnected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }
}
