import SwiftUI


final class LikesViewModel: ObservableObject {
    @Published var visibility: LikesVisibility = .visible
    @Published var count: Int = 0
    @Published var likes: [IncomingLike] = []
    @Published var error: String?

    private let api: APIClient
    init(api: APIClient) { self.api = api }

    func load() async {
        do {
            let resp = try await api.incomingLikes()
            visibility = LikesVisibility(rawValue: resp.visibility) ?? .visible
            count = resp.count ?? 0
            likes = resp.likes
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct LikesView: View {
    @EnvironmentObject private var api: APIClient
    @StateObject private var vm: LikesViewModel

    init() {
        _vm = StateObject(wrappedValue: LikesViewModel(api: APIClient(baseURL: APIConfig.defaultBaseURL)))
    }

    var body: some View {
        NavigationStack {
            OMScreen {
                ScrollView {
                    switch vm.visibility {
                    case .visible:
                        visibleState
                    case .count_only:
                        countOnlyState
                    case .hidden:
                        hiddenState
                    }
                }
            }
            .omNavTitle("Likes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gear")
                            .foregroundStyle(OMColor.moss)
                    }
                }
            }
            .task { await vm.load() }
        }
    }

    private var visibleState: some View {
        VStack(alignment: .leading, spacing: OMSpacing.lg) {
            Text("\(vm.count) people liked you")
                .font(OMFont.display(26, weight: .semibold, italic: true))
                .foregroundStyle(OMColor.ink)
                .padding(.horizontal, OMSpacing.lg)
            FreeBanner()
                .padding(.horizontal, OMSpacing.lg)
            LazyVStack(spacing: OMSpacing.md) {
                ForEach(vm.likes) { like in
                    LikeRow(like: like)
                }
            }
            .padding(.horizontal, OMSpacing.lg)
        }
        .padding(.top, OMSpacing.sm)
    }

    private var countOnlyState: some View {
        VStack(spacing: OMSpacing.lg) {
            BotanicPlaceholder(.avatar(80))
            Text("\(vm.count) people liked you")
                .font(OMFont.display(26, weight: .semibold, italic: true))
                .foregroundStyle(OMColor.ink)
            Text("You've chosen to see only the count. Profiles are hidden until you open them in the Swipe deck. Change this anytime in Settings — it's always free.")
                .font(OMFont.callout)
                .foregroundStyle(OMColor.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, OMSpacing.xl)
            NavigationLink("Settings") { SettingsView() }
                .buttonStyle(OMPrimaryButtonStyle())
                .padding(.horizontal, OMSpacing.xl)
        }
        .padding(.top, 40)
    }

    private var hiddenState: some View {
        VStack(spacing: OMSpacing.lg) {
            Image(systemName: "eye.slash")
                .font(.system(size: 48))
                .foregroundStyle(OMColor.inkMuted)
            Text("Incoming likes are hidden")
                .font(OMFont.display(24, weight: .semibold, italic: true))
                .foregroundStyle(OMColor.ink)
            Text("You can keep them hidden for a calmer experience, or turn them on anytime. This is free either way.")
                .font(OMFont.callout)
                .foregroundStyle(OMColor.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, OMSpacing.xl)
            NavigationLink("Show my likes") { SettingsView() }
                .buttonStyle(OMPrimaryButtonStyle())
                .padding(.horizontal, OMSpacing.xl)
        }
        .padding(.top, 40)
    }
}

private struct LikeRow: View {
    let like: IncomingLike
    var body: some View {
        HStack(spacing: OMSpacing.md) {
            BotanicPlaceholder(.avatar(56))
            VStack(alignment: .leading, spacing: 2) {
                Text(like.from.profile?.displayName ?? "Someone")
                    .font(OMFont.body(16, weight: .semibold))
                    .foregroundStyle(OMColor.ink)
                Text(like.from.profile?.bio ?? "")
                    .font(OMFont.callout)
                    .foregroundStyle(OMColor.inkMuted)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OMColor.inkMuted)
        }
        .padding(12)
        .background(
            OMShape.card(OMRadius.md).fill(OMColor.surfaceElevated)
        )
        .overlay(
            OMShape.card(OMRadius.md).stroke(OMColor.cardStroke, lineWidth: 1)
        )
    }
}

private struct FreeBanner: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.open")
            Text("Seeing who liked you is free. Always.")
                .font(OMFont.callout)
        }
        .foregroundStyle(OMColor.onAccent)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            OMShape.card(OMRadius.md).fill(OMColor.terracotta)
        )
    }
}
