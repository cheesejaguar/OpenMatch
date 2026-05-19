import SwiftUI

struct MainTabView: View {
    enum Tab: Hashable { case swipe, likes, chat, profile }

    @ObservedObject var gate: ProfileGate

    @State private var selection: Tab = {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["OPENMATCH_INITIAL_TAB"] ?? "" {
        case "likes": return .likes
        case "chat": return .chat
        case "profile": return .profile
        default: return .swipe
        }
        #else
        return .swipe
        #endif
    }()

    var body: some View {
        TabView(selection: $selection) {
            // IOS-6 — Swipe tab is replaced with a completion CTA
            // when the profile isn't ready. We *don't* show the
            // (eventually empty) deck because it conflates "no nearby
            // matches" with "you can't be matched yet".
            Group {
                if gate.isComplete {
                    SwipeDeckView()
                } else {
                    ProfileIncompleteFullScreen(
                        dto: gate.dto,
                        onTapComplete: { selection = .profile }
                    )
                }
            }
            .tabItem {
                Label("Swipe", systemImage: "rectangle.stack.fill")
            }
            .tag(Tab.swipe)

            LikesView()
                .tabItem {
                    Label("Likes", systemImage: "heart.fill")
                }
                .tag(Tab.likes)

            ChatListView()
                .tabItem {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
                }
                .tag(Tab.chat)

            ProfileHomeView()
                .tabItem {
                    Label("Profile", systemImage: "person.crop.circle.fill")
                }
                .tag(Tab.profile)
        }
        .tint(OMColor.plum)
        .safeAreaInset(edge: .top, spacing: 0) {
            if !gate.isComplete && selection != .swipe {
                ProfileIncompleteBanner(onTapComplete: { selection = .profile })
            }
        }
    }
}

// Sticky top banner on non-Swipe tabs reminding the user to finish
// their profile. We use safeAreaInset so it doesn't overlap content.
private struct ProfileIncompleteBanner: View {
    let onTapComplete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(OMColor.marigold)
            VStack(alignment: .leading, spacing: 0) {
                Text("Finish your profile to start swiping")
                    .font(OMFont.body(14, weight: .semibold))
                    .foregroundStyle(OMColor.ink)
                Text("You need 2 photos and a display name.")
                    .font(OMFont.caption)
                    .foregroundStyle(OMColor.inkMuted)
            }
            Spacer(minLength: 8)
            Button("Complete", action: onTapComplete)
                .font(OMFont.caption.weight(.semibold))
                .foregroundStyle(OMColor.onAccent)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(OMColor.plum, in: Capsule())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(OMColor.surfaceElevated)
        .overlay(alignment: .bottom) {
            Rectangle().fill(OMColor.divider).frame(height: 1)
        }
    }
}

// Full-screen replacement for the Swipe tab when the profile isn't
// complete. We don't show the (server-side-empty) deck because it
// would be a confusing experience.
private struct ProfileIncompleteFullScreen: View {
    let dto: ProfileCompletenessDTO?
    let onTapComplete: () -> Void

    var body: some View {
        NavigationStack {
            content
                .omNavTitle("Almost there")
        }
    }

    private var content: some View {
        OMScreen {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "leaf.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(OMColor.plum.opacity(0.7))
                    Text("One more step before you can swipe")
                        .font(OMFont.display(24, weight: .semibold, italic: true))
                        .foregroundStyle(OMColor.plum)
                        .multilineTextAlignment(.center)
                    Text("OpenMatch requires every profile to have at least 2 photos and a display name before it can be shown — to you, or to anyone you might match with.")
                        .font(OMFont.callout)
                        .foregroundStyle(OMColor.inkMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                    if let dto {
                        VStack(alignment: .leading, spacing: 6) {
                            CheckRow(done: dto.hasPhotos, label: "At least 2 photos (you have \(dto.photoCount))")
                            CheckRow(done: dto.hasDisplayName, label: "Display name")
                            CheckRow(done: dto.isAgeVerified, label: "Age verification")
                        }
                        .padding(.vertical, 8)
                    }
                    NavigationLink {
                        EditProfileView()
                    } label: {
                        Text("Complete my profile")
                    }
                    .buttonStyle(OMPrimaryButtonStyle())
                    Button("Go to Profile tab", action: onTapComplete)
                        .font(OMFont.callout.weight(.semibold))
                        .foregroundStyle(OMColor.plum)
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct CheckRow: View {
    let done: Bool
    let label: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? OMColor.plum : OMColor.inkMuted)
            Text(label)
                .font(OMFont.body(14, weight: .medium))
                .foregroundStyle(OMColor.ink)
        }
    }
}
