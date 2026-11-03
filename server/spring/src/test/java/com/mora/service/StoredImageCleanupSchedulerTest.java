package com.mora.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StoredImageCleanupSchedulerTest {
    @Test
    void failuresDoNotLogExceptionMessagesOrStackTracesAndOtherItemsStillRun() {
        StoredImageService images = mock(StoredImageService.class);
        StoredImageDeletionService deletions = mock(StoredImageDeletionService.class);
        UUID failedOwner = UUID.randomUUID();
        UUID nextOwner = UUID.randomUUID();
        when(deletions.findPending()).thenReturn(List.of("failed.jpg", "next.jpg"));
        when(images.findCleanupOwners(any())).thenReturn(List.of(failedOwner, nextOwner));
        RuntimeException sensitive = new RuntimeException("private upstream response", new IllegalStateException("secret"));
        doThrow(sensitive).when(deletions).deleteQueued("failed.jpg");
        doThrow(sensitive).when(images).cleanupExpired(eq(failedOwner), any());
        Logger logger = (Logger) LoggerFactory.getLogger(StoredImageCleanupScheduler.class);
        ListAppender<ILoggingEvent> logs = new ListAppender<>();
        logs.start();
        logger.addAppender(logs);
        try {
            new StoredImageCleanupScheduler(images, deletions).cleanup();
            assertEquals(2, logs.list.size());
            for (ILoggingEvent event : logs.list) {
                assertTrue(event.getFormattedMessage().contains("RuntimeException"));
                assertFalse(event.getFormattedMessage().contains("private upstream response"));
                assertFalse(event.getFormattedMessage().contains("secret"));
                assertNull(event.getThrowableProxy());
            }
            verify(deletions).deleteQueued("next.jpg");
            verify(images).cleanupExpired(eq(nextOwner), any());
        } finally {
            logger.detachAppender(logs);
            logs.stop();
        }
    }
}
