package com.mora.dto;

import com.mora.entity.Ticket;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.UUID;

@Getter
@Setter
public class TicketResponse {
    private Integer id;
    private UUID userId;
    private String docType;
    private BigDecimal classificationConfidence;
    private String transportType;
    private String departureLocation;
    private LocalDate departureDate;
    private LocalTime departureTime;
    private String arrivalLocation;
    private LocalDate arrivalDate;
    private LocalTime arrivalTime;
    private String rawText;
    private String parsedJson;
    private String rawJson;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Double similarity;

    public static TicketResponse from(Ticket ticket) {
        TicketResponse response = new TicketResponse();
        response.setId(ticket.getId());
        response.setUserId(ticket.getUserId());
        response.setDocType(ticket.getDocType());
        response.setClassificationConfidence(ticket.getClassificationConfidence());
        response.setTransportType(ticket.getTransportType());
        response.setDepartureLocation(ticket.getDepartureLocation());
        response.setDepartureDate(ticket.getDepartureDate());
        response.setDepartureTime(ticket.getDepartureTime());
        response.setArrivalLocation(ticket.getArrivalLocation());
        response.setArrivalDate(ticket.getArrivalDate());
        response.setArrivalTime(ticket.getArrivalTime());
        response.setRawText(ticket.getRawText());
        response.setParsedJson(ticket.getParsedJson());
        response.setRawJson(ticket.getRawJson());
        response.setCreatedAt(ticket.getCreatedAt());
        response.setUpdatedAt(ticket.getUpdatedAt());
        return response;
    }
}
