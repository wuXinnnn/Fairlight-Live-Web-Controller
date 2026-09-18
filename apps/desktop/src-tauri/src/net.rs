//! Picking the address to show in the window, and turning it into the URLs the user copies.
//!
//! The console start scripts deliberately do not print a LAN address because enumerating
//! interfaces differs too much between platforms for a shell script. Here it is worth doing:
//! the whole reason the launcher exists is to tell you what to type into a tablet.

use std::net::Ipv4Addr;

/// One interface as far as the choice is concerned. Keeping this a plain tuple-ish struct
/// rather than `if_addrs::Interface` is what makes the choice testable without a network.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Interface {
    pub name: String,
    pub address: Ipv4Addr,
    pub is_loopback: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Urls {
    pub local: String,
    pub lan: Option<String>,
}

/// Lower is better. Private ranges come first because that is what a tablet on the same
/// Wi-Fi can reach; a public address on a machine running an audio desk is almost always a
/// VPN or a tunnel and not the one to print.
fn rank(address: Ipv4Addr) -> u8 {
    let [a, b, ..] = address.octets();
    match (a, b) {
        (192, 168) => 0,
        (10, _) => 1,
        (172, 16..=31) => 2,
        _ => 3,
    }
}

/// The address to show, or `None` when the machine has nothing but loopback.
///
/// Link-local `169.254.0.0/16` is excluded outright: it means DHCP failed, so the address
/// exists but nothing can reach it.
pub fn pick_lan_ipv4(interfaces: &[Interface]) -> Option<Ipv4Addr> {
    interfaces
        .iter()
        .filter(|interface| !interface.is_loopback)
        .filter(|interface| !interface.address.is_loopback())
        .filter(|interface| !interface.address.is_link_local())
        .min_by_key(|interface| rank(interface.address))
        .map(|interface| interface.address)
}

/// The two addresses the window shows. `lan` is `None` when `bind_lan` is off -- the backend
/// is then only listening on loopback, so printing a LAN address would be a lie -- or when
/// there is no usable interface.
pub fn urls(port: u16, bind_lan: bool, lan: Option<Ipv4Addr>) -> Urls {
    Urls {
        local: format!("http://localhost:{port}"),
        lan: match (bind_lan, lan) {
            (true, Some(address)) => Some(format!("http://{address}:{port}")),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(name: &str, address: [u8; 4], is_loopback: bool) -> Interface {
        Interface {
            name: name.to_owned(),
            address: Ipv4Addr::from(address),
            is_loopback,
        }
    }

    #[test]
    fn no_interfaces_means_no_address() {
        assert_eq!(pick_lan_ipv4(&[]), None);
    }

    #[test]
    fn loopback_only_means_no_address() {
        let interfaces = [interface("lo", [127, 0, 0, 1], true)];
        assert_eq!(pick_lan_ipv4(&interfaces), None);
    }

    #[test]
    fn an_unflagged_loopback_address_is_still_skipped() {
        let interfaces = [interface("lo", [127, 0, 0, 1], false)];
        assert_eq!(pick_lan_ipv4(&interfaces), None);
    }

    #[test]
    fn link_local_is_skipped() {
        let interfaces = [interface("Ethernet", [169, 254, 7, 9], false)];
        assert_eq!(pick_lan_ipv4(&interfaces), None);
    }

    #[test]
    fn home_networks_win_over_everything_else() {
        let interfaces = [
            interface("Tailscale", [100, 64, 0, 3], false),
            interface("Docker", [172, 17, 0, 1], false),
            interface("Corporate", [10, 1, 2, 3], false),
            interface("Wi-Fi", [192, 168, 1, 40], false),
        ];
        assert_eq!(
            pick_lan_ipv4(&interfaces),
            Some(Ipv4Addr::new(192, 168, 1, 40))
        );
    }

    #[test]
    fn ten_beats_one_seventy_two() {
        let interfaces = [
            interface("Docker", [172, 17, 0, 1], false),
            interface("Corporate", [10, 1, 2, 3], false),
        ];
        assert_eq!(pick_lan_ipv4(&interfaces), Some(Ipv4Addr::new(10, 1, 2, 3)));
    }

    #[test]
    fn one_seventy_two_outside_the_private_block_is_ranked_last() {
        let interfaces = [
            interface("Public", [172, 32, 0, 1], false),
            interface("Docker", [172, 17, 0, 1], false),
        ];
        assert_eq!(
            pick_lan_ipv4(&interfaces),
            Some(Ipv4Addr::new(172, 17, 0, 1))
        );
    }

    #[test]
    fn a_public_address_is_used_when_it_is_all_there_is() {
        let interfaces = [interface("WAN", [203, 0, 113, 8], false)];
        assert_eq!(
            pick_lan_ipv4(&interfaces),
            Some(Ipv4Addr::new(203, 0, 113, 8))
        );
    }

    #[test]
    fn the_first_of_equally_ranked_interfaces_wins() {
        let interfaces = [
            interface("Wi-Fi", [192, 168, 1, 40], false),
            interface("Ethernet", [192, 168, 1, 41], false),
        ];
        assert_eq!(
            pick_lan_ipv4(&interfaces),
            Some(Ipv4Addr::new(192, 168, 1, 40))
        );
    }

    #[test]
    fn urls_include_the_lan_address_when_bound_to_the_network() {
        let urls = urls(3000, true, Some(Ipv4Addr::new(192, 168, 1, 40)));
        assert_eq!(urls.local, "http://localhost:3000");
        assert_eq!(urls.lan.as_deref(), Some("http://192.168.1.40:3000"));
    }

    #[test]
    fn urls_omit_the_lan_address_when_bound_to_loopback() {
        let urls = urls(3100, false, Some(Ipv4Addr::new(192, 168, 1, 40)));
        assert_eq!(urls.local, "http://localhost:3100");
        assert_eq!(urls.lan, None);
    }

    #[test]
    fn urls_omit_the_lan_address_when_there_is_no_interface() {
        assert_eq!(urls(3000, true, None).lan, None);
    }
}
