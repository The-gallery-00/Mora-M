package com.mora.dto;

import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

@Getter
@Setter
public class TicketRequest {
    private String docType;
    private BigDecimal classificationConfidence;
    private String transportType;
    private String departureLocation;
    private String departureDate;
    private String departureTime;
    private String arrivalLocation;
    private String arrivalDate;
    private String arrivalTime;
    private List<String> rawText;
    private String parsedJson;
    private String rawJson;
}
