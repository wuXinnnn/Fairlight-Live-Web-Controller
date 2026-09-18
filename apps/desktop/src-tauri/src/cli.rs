//! The two command-line options the launcher takes.
//!
//! `--hidden` is what the autostart registration passes, so a machine that starts the
//! launcher at login does not throw a window at the user. `--port` overrides the saved port
//! for one run and exists for development: the saved default is 3000, which is also the port
//! a checkout's `pnpm dev` uses.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CliOptions {
    pub port: Option<u16>,
    pub hidden: bool,
}

/// Parses the arguments after the executable name. Anything unrecognised is ignored rather
/// than rejected: Windows hands applications arguments of its own, and a launcher that
/// refuses to start over one would be worse than one that shrugs.
pub fn parse_args<I>(arguments: I) -> CliOptions
where
    I: IntoIterator<Item = String>,
{
    let mut options = CliOptions::default();
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--hidden" => options.hidden = true,
            "--port" => options.port = arguments.next().and_then(|value| value.parse().ok()),
            other => {
                if let Some(value) = other.strip_prefix("--port=") {
                    options.port = value.parse().ok();
                }
            }
        }
    }
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> CliOptions {
        parse_args(arguments.iter().map(|argument| (*argument).to_owned()))
    }

    #[test]
    fn nothing_given_means_nothing_set() {
        assert_eq!(parse(&[]), CliOptions::default());
    }

    #[test]
    fn hidden_is_a_flag() {
        assert_eq!(
            parse(&["--hidden"]),
            CliOptions {
                port: None,
                hidden: true
            }
        );
    }

    #[test]
    fn port_takes_the_next_argument() {
        assert_eq!(parse(&["--port", "3100"]).port, Some(3100));
    }

    #[test]
    fn port_also_takes_an_equals_sign() {
        assert_eq!(parse(&["--port=3100"]).port, Some(3100));
    }

    #[test]
    fn both_options_can_be_given_together() {
        assert_eq!(
            parse(&["--hidden", "--port", "3100"]),
            CliOptions {
                port: Some(3100),
                hidden: true
            }
        );
    }

    #[test]
    fn a_port_that_is_not_a_number_is_ignored() {
        assert_eq!(parse(&["--port", "not-a-port"]).port, None);
    }

    #[test]
    fn a_port_outside_the_range_is_ignored() {
        assert_eq!(parse(&["--port", "70000"]).port, None);
    }

    #[test]
    fn a_trailing_port_with_no_value_is_ignored() {
        assert_eq!(parse(&["--port"]).port, None);
    }

    #[test]
    fn unknown_arguments_are_ignored() {
        assert_eq!(parse(&["--wat", "/background"]), CliOptions::default());
    }
}
