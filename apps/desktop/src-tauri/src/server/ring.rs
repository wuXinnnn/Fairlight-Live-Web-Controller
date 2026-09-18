//! A bounded buffer of the backend's most recent log lines.
//!
//! The window only ever shows the tail, and a desk left running for a show would otherwise
//! accumulate an unbounded amount of pino JSON in memory. The full log is on disk.

use std::collections::VecDeque;

pub struct LogRing {
    lines: VecDeque<String>,
    capacity: usize,
}

impl LogRing {
    pub fn new(capacity: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(capacity.min(1024)),
            capacity,
        }
    }

    pub fn push(&mut self, line: String) {
        if self.capacity == 0 {
            return;
        }
        while self.lines.len() >= self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    /// The last `count` lines, oldest first.
    pub fn tail(&self, count: usize) -> Vec<String> {
        self.lines
            .iter()
            .skip(self.lines.len().saturating_sub(count))
            .cloned()
            .collect()
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fill(ring: &mut LogRing, count: usize) {
        for index in 0..count {
            ring.push(format!("line {index}"));
        }
    }

    #[test]
    fn keeps_everything_while_under_capacity() {
        let mut ring = LogRing::new(5);
        fill(&mut ring, 3);
        assert_eq!(ring.tail(10), vec!["line 0", "line 1", "line 2"]);
    }

    #[test]
    fn drops_the_oldest_lines_past_capacity() {
        let mut ring = LogRing::new(3);
        fill(&mut ring, 5);
        assert_eq!(ring.tail(10), vec!["line 2", "line 3", "line 4"]);
    }

    #[test]
    fn tail_returns_at_most_what_was_asked_for() {
        let mut ring = LogRing::new(10);
        fill(&mut ring, 6);
        assert_eq!(ring.tail(2), vec!["line 4", "line 5"]);
    }

    #[test]
    fn tail_of_zero_is_empty() {
        let mut ring = LogRing::new(10);
        fill(&mut ring, 3);
        assert!(ring.tail(0).is_empty());
    }

    #[test]
    fn a_zero_capacity_ring_stays_empty() {
        let mut ring = LogRing::new(0);
        fill(&mut ring, 3);
        assert!(ring.tail(10).is_empty());
    }

    #[test]
    fn clear_empties_it() {
        let mut ring = LogRing::new(10);
        fill(&mut ring, 3);
        ring.clear();
        assert!(ring.tail(10).is_empty());
    }
}
