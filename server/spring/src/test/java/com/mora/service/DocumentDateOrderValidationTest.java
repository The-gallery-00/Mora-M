package com.mora.service;

import com.mora.dto.PosterRequest;
import com.mora.dto.TicketRequest;
import com.mora.entity.Poster;
import com.mora.entity.Ticket;
import com.mora.repository.PosterRepository;
import com.mora.repository.TicketRepository;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DocumentDateOrderValidationTest {

    @Test
    void ticketUpdateRejectsArrivalDateBeforeDepartureDate() {
        TicketRepository repository = mock(TicketRepository.class);
        TicketService service = new TicketService(repository, mock(EmbeddingService.class));
        UUID userId = UUID.randomUUID();
        Ticket ticket = new Ticket();
        ticket.setId(1);
        ticket.setUserId(userId);
        ticket.setDepartureDate(LocalDate.of(2026, 8, 20));
        ticket.setArrivalDate(LocalDate.of(2026, 8, 22));
        TicketRequest request = new TicketRequest();
        request.setArrivalDate("2026-08-19");

        when(repository.findByIdAndUserId(1, userId)).thenReturn(Optional.of(ticket));

        IllegalArgumentException error = assertThrows(
                IllegalArgumentException.class,
                () -> service.update(userId, 1, request));

        assertEquals("Arrival date cannot be before departure date", error.getMessage());
        verify(repository, never()).save(ticket);
    }

    @Test
    void posterUpdateRejectsEndDateBeforeStartDate() {
        PosterRepository repository = mock(PosterRepository.class);
        PosterService service = new PosterService(repository, mock(EmbeddingService.class));
        UUID userId = UUID.randomUUID();
        Poster poster = new Poster();
        poster.setId(1);
        poster.setUserId(userId);
        poster.setEventStartDate(LocalDate.of(2026, 8, 20));
        poster.setEventEndDate(LocalDate.of(2026, 8, 22));
        PosterRequest request = new PosterRequest();
        request.setEventEndDate("2026-08-19");

        when(repository.findByIdAndUserId(1, userId)).thenReturn(Optional.of(poster));

        IllegalArgumentException error = assertThrows(
                IllegalArgumentException.class,
                () -> service.update(userId, 1, request));

        assertEquals("Event end date cannot be before event start date", error.getMessage());
        verify(repository, never()).save(poster);
    }
}
