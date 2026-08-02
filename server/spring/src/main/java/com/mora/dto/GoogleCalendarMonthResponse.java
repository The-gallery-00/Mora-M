package com.mora.dto;

import java.util.List;
import java.util.UUID;

public class GoogleCalendarMonthResponse {
    private UUID userId;
    private int year;
    private int month;
    private boolean connected;
    private List<Object> events;

    public GoogleCalendarMonthResponse(UUID userId, int year, int month, boolean connected) {
        this.userId = userId;
        this.year = year;
        this.month = month;
        this.connected = connected;
        this.events = List.of();
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public int getYear() {
        return year;
    }

    public void setYear(int year) {
        this.year = year;
    }

    public int getMonth() {
        return month;
    }

    public void setMonth(int month) {
        this.month = month;
    }

    public boolean isConnected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }

    public List<Object> getEvents() {
        return events;
    }

    public void setEvents(List<Object> events) {
        this.events = events;
    }
}
