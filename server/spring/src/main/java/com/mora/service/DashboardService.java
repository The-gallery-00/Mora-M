package com.mora.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mora.dto.DashboardResponse;
import com.mora.entity.Poster;
import com.mora.entity.Ticket;
import com.mora.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
public class DashboardService {
    private static final int DEADLINE_LIMIT = 20;
    private final BusinessCardRepository cards;
    private final PosterRepository posters;
    private final TicketRepository tickets;
    private final ReceiptRepository receipts;
    private final ObjectMapper objectMapper;

    public DashboardService(BusinessCardRepository cards, PosterRepository posters,
                            TicketRepository tickets, ReceiptRepository receipts,
                            ObjectMapper objectMapper) {
        this.cards = cards; this.posters = posters; this.tickets = tickets; this.receipts = receipts;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public DashboardResponse get(UUID userId, LocalDate date, int requestedDays) {
        LocalDate base = date == null ? LocalDate.now() : date;
        int days = Math.max(0, requestedDays);
        LocalDate end = base.plusDays(days);
        List<DashboardResponse.DeadlineItem> deadlines = new ArrayList<>();
        for (Ticket t : tickets.findByUserIdAndDepartureDateBetweenOrderByDepartureDateAscDepartureTimeAsc(userId, base, end)) {
            deadlines.add(new DashboardResponse.DeadlineItem("TICKET", String.valueOf(t.getId()),
                    title(t), value(t.getTransportType()), t.getDepartureDate(),
                    ChronoUnit.DAYS.between(base, t.getDepartureDate()), imageUrl(t.getParsedJson())));
        }
        for (Poster p : posters.findByUserIdAndEventStartDateBetweenOrderByEventStartDateAsc(userId, base, end)) {
            deadlines.add(new DashboardResponse.DeadlineItem("POSTER", String.valueOf(p.getId()),
                    value(p.getTitle()), value(p.getOrganizerName()), p.getEventStartDate(),
                    ChronoUnit.DAYS.between(base, p.getEventStartDate()), imageUrl(p.getParsedJson())));
        }
        deadlines.sort(Comparator.comparingLong(DashboardResponse.DeadlineItem::dDay));
        List<DashboardResponse.DeadlineItem> limited = deadlines.stream().limit(DEADLINE_LIMIT).toList();

        List<DashboardResponse.ScheduleItem> schedules = new ArrayList<>();
        for (Ticket t : tickets.findByUserIdAndDepartureDateOrderByDepartureTimeAsc(userId, base)) {
            schedules.add(new DashboardResponse.ScheduleItem("TICKET", String.valueOf(t.getId()),
                    title(t), t.getDepartureTime(), t.getDepartureDate()));
        }
        for (Poster p : posters.findByUserIdAndEventStartDateOrderByCreatedAtAsc(userId, base)) {
            schedules.add(new DashboardResponse.ScheduleItem("POSTER", String.valueOf(p.getId()),
                    value(p.getTitle()), null, p.getEventStartDate()));
        }
        long total = cards.countByUserId(userId) + posters.countByUserId(userId)
                + tickets.countByUserId(userId) + receipts.countByUserId(userId);
        return new DashboardResponse(base, days, schedules.size(), limited.size(), total, limited, schedules);
    }

    private static String title(Ticket t) {
        return value(t.getDepartureLocation()) + " → " + value(t.getArrivalLocation());
    }
    private static String value(String value) { return value == null ? "" : value; }

    private String imageUrl(String parsedJson) {
        if (parsedJson == null || parsedJson.isBlank()) return "";
        try {
            JsonNode root = objectMapper.readTree(parsedJson);
            JsonNode value = root.get("imageUrl");
            if (value == null || !value.isTextual() || value.asText().isBlank()) {
                value = root.get("image_url");
            }
            return value != null && value.isTextual() ? value.asText() : "";
        } catch (JsonProcessingException e) {
            return "";
        }
    }
}
